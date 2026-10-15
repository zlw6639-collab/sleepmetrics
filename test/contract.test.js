/**
 * ★ 输入契约：`auditRecords()` 与 `normalize()` 必须对「一条记录算不算数」给同一个答案。
 *
 * 背景（2026-10-15 复核外部评审报告，逐条实测）—— 两边原来各判一套：
 *   · `{bed:0, wake:1000}`  ⇒ audit 只给 info、`ok:true`，而 `normalize()` 直接丢掉它
 *   · `dur: -20`            ⇒ `normalize()` 原样保留 −20，audit 把它当成「过短小睡」的 info
 *   · `dur: 'abc'`          ⇒ audit 报 warn 并回退到推导值，`normalize()` 却丢掉**整条**记录
 *   · `wake <= bed`         ⇒ audit 报 error 但**仍把它算进 summary.records**，normalize 也保留
 *
 * ⇒ 后果是「**体检放行、规范化却少收记录**」，而少收的那条**没有任何 error 抬头**。
 *   这正是本库最反对的那种失败：脏数据不报错，只是静静地给出不同的数字。
 *
 * 判据（本文件即规格）：**`normalize()` 丢弃的每一条，audit 都必须至少报一个 `error`。**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditRecords } from '../src/audit.js';
import { normalize } from '../src/records.js';
import { buildGrid } from '../src/sri.js';
import * as fx from './fixtures/synthetic.mjs';

const TZ = fx.TZ;
const k = (h) => fx.at(fx.d(1), h);
const rules = (r) => r.issues.map((x) => x.ruleId);

/** 每一条都至少有一处不对 —— **全是该被丢掉的**（`normalize()` 一条都不该收） */
const DIRTY = [
  null,
  'not-an-object',
  42,
  {},
  { bed: Number.NaN, wake: k(9) },
  { bed: k(1), wake: 'later' },
  { bed: 0, wake: k(9) },
  { bed: -5, wake: k(9) },
  { bed: k(1), wake: 0 },
  { bed: k(9), wake: k(1) }, // wake 早于 bed
  { bed: k(1), wake: k(1) }, // wake == bed
  { bed: k(1), wake: 9e15 }, // 超出 Date 可表示范围（JS Date 上限约 ±8.64e12 epoch 秒）
  { bed: k(1), wake: k(1) + 2 * 86400 }, // 跨两天的「一段睡眠」不存在
];

/* ─────────── 核心不变量 ─────────── */

test('★ 非空守卫：DIRTY 里确实有记录会被 normalize() 丢掉 —— 否则下面的不变量是假通过（AGENTS.md 硬规矩 6）', () => {
  const dropped = DIRTY.filter((r) => normalize([r], TZ).length === 0);
  assert.ok(
    dropped.length >= 5,
    `只有 ${dropped.length} 条会被丢弃 —— 样本不足以证明这条不变量，先修样本而不是删测试`,
  );
});

test('★ 不变量：normalize() 丢弃的每一条，auditRecords() 都必须报出 error', () => {
  for (const rec of DIRTY) {
    if (normalize([rec], TZ).length > 0) continue; // 没被丢 ⇒ 本条不适用
    const a = auditRecords([rec]);
    assert.ok(
      a.summary.bySeverity.error > 0,
      `normalize 丢掉了 ${JSON.stringify(rec)}，audit 却说 ok=${a.summary.ok}`
      + `（issues: ${JSON.stringify(rules(a))}）—— 这就是「体检放行、规范化静默丢数据」`,
    );
  }
});

test('★ summary.records 必须等于 normalize() 收下的条数（同一个数据集不能有两个「几条」）', () => {
  const mixed = [
    { bed: k(1), wake: k(9) },
    { bed: 0, wake: k(9) }, // normalize 丢
    { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9) },
    null, // normalize 丢
  ];
  const a = auditRecords(mixed);
  assert.equal(a.summary.records, normalize(mixed, TZ).length);
  assert.equal(a.summary.records, 2);
});

/* ─────────── A2：非正时间戳 ─────────── */

test('★ bed <= 0：报 error（原来 ok:true，而 normalize 早已把它丢掉 —— 两边说的不是一件事）', () => {
  const rec = { bed: 0, wake: k(9), dur: 10 };
  const a = auditRecords([rec]);
  assert.equal(a.summary.ok, false, 'ok 必须为 false');
  assert.ok(rules(a).includes('time.bed-not-positive'), '要有专门的非正时间戳规则');
  assert.equal(normalize([rec], TZ).length, 0, 'normalize 仍然丢弃它 —— 两边现在一致');
});

test('★ wake <= 0：报 error', () => {
  const a = auditRecords([{ bed: k(1), wake: -1 }]);
  assert.equal(a.summary.ok, false);
  assert.ok(rules(a).includes('time.wake-not-positive'));
});

/* ─────────── A3 + B3：非正 / 非数字的 dur ─────────── */

test('★ dur <= 0：给**独立规则**（不是「过短小睡」），且 normalize 回退到推导时长', () => {
  const rec = { bed: k(1), wake: k(2), dur: -20 }; // 卧床 60 分钟
  const a = auditRecords([rec]);
  assert.ok(rules(a).includes('dur.non-positive'), '必须有独立规则，别用「过短小睡」代替数值合法性校验');
  assert.equal(a.summary.ok, false);

  const out = normalize([rec], TZ);
  assert.equal(out.length, 1, '记录的时间戳本身合法 ⇒ 不该把整条丢掉');
  assert.equal(out[0].dur, 60, 'dur 非正 ⇒ 视为「未给」，回退到 (wake - bed) / 60');
});

test('★ dur 不是数字：audit 回退，normalize 也必须回退（原来它丢掉整条 8 小时睡眠）', () => {
  const rec = { bed: k(1), wake: k(13), dur: 'abc' };
  assert.ok(rules(auditRecords([rec])).includes('dur.not-a-number'));
  const out = normalize([rec], TZ);
  assert.equal(out.length, 1, 'dur 字段脏不该让整段睡眠消失');
  assert.equal(out[0].dur, 720);
});

test('dur 为 null 仍然视为「未给」（不是 0 分钟，也不是非法值）—— 钉住已有语义', () => {
  const rec = { bed: k(1), wake: k(9), dur: null };
  const a = auditRecords([rec]);
  assert.ok(!rules(a).includes('dur.non-positive'));
  assert.ok(!rules(a).includes('dur.not-a-number'));
  assert.ok(!rules(a).includes('dur.too-short'));
  assert.equal(normalize([rec], TZ)[0].dur, 480);
});

/* ─────────── 干净数据不许被这次收紧误伤 ─────────── */

test('干净数据：仍然零问题、ok = true、一条不少（收紧判据不许误伤正常记录）', () => {
  const good = [
    { bed: k(1), wake: k(9), tz: TZ },
    { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9), tz: TZ },
  ];
  const a = auditRecords(good);
  assert.deepEqual(a.issues, []);
  assert.equal(a.summary.ok, true);
  assert.equal(a.summary.records, normalize(good, TZ).length);
});

/* ─────────── 极端时间戳：不许崩，更不许挂死 ─────────── */

/**
 * 2026-10-15 复核：极端但**有限**的时间戳是这个库里唯一「比抛错更坏」的输入 —— 它会**不返回**。
 *   · `normalize()` / `auditRecords()`：`new Date(9e18).toISOString()` 抛 `RangeError`；
 *   · `buildGrid()`：`mark()` 的循环 `for (t = …; t < to; t += 60)` 迭代次数 ∝ `(to − from) / 60`，
 *     `wake = 6e8` 实测就要 **6717 ms**，`9e15` 约 **1.5e14 次** ⇒ 等同挂死。
 * ⇒ 抛错还看得见，**挂死看不见** —— 这是本项目最反对的那种失败。
 *
 * 上限取 **24 小时**：真实数据实测最长 9.57 h（121 条）/ 9.57 h（全量 284 条），余量充足；
 * 而且 `auditRecords()` 早就把「单段超过 24 小时」当不可能（`dur.too-long`），语义一致。
 */

test('★ normalize：极端时间戳不抛异常，按「无效记录」丢掉', () => {
  let out;
  assert.doesNotThrow(() => { out = normalize([{ bed: k(1), wake: 9e15 }], TZ); });
  assert.deepEqual(out, []);
});

test('★ auditRecords：极端时间戳报 time.not-representable（原来它自己先抛 RangeError）', () => {
  let a;
  assert.doesNotThrow(() => { a = auditRecords([{ bed: k(1), wake: 9e15 }]); });
  assert.equal(a.summary.ok, false);
  assert.ok(rules(a).includes('time.not-representable'));
});

test('★ 跨度过大（> 24h）的段也是判据的一部分：audit 报 error、normalize 丢掉', () => {
  const rec = { bed: k(1), wake: k(1) + 2 * 86400 };
  assert.ok(rules(auditRecords([rec])).includes('time.span-too-long'));
  assert.deepEqual(normalize([rec], TZ), []);
});

test('★ buildGrid：跨度过大的段直接跳过 —— 不许让循环跑到天荒地老', () => {
  const t0 = Date.now();
  const g = buildGrid([{ bed: 0, wake: 6e8 }]); // 修复前实测 6717 ms
  const ms = Date.now() - t0;
  assert.equal(g.size, 0, '这种段不该进网格');
  assert.ok(ms < 500, `耗时 ${ms} ms —— 守卫没生效（修复前这个输入要跑约 6.7 秒）`);
});

test('★ buildGrid：不可表示的时间戳也跳过（它可能被直接调用，不能指望调用方先 normalize）', () => {
  assert.equal(buildGrid([{ bed: 0, wake: 9e15 }]).size, 0);
});

test('★ buildGrid：正常记录仍然照常标记（守卫不许误伤）', () => {
  const g = buildGrid([{ bed: k(1), wake: k(9), tz: TZ }], TZ);
  assert.equal(g.size, 1);
  const day = g.get([...g.keys()][0]);
  let asleep = 0;
  for (const v of day) if (v) asleep += 1;
  assert.equal(asleep, 480, '01:00→09:00 应是 480 分钟');
});

test('★ auditRecords：单个 stage 跨度过大也要报出来（buildGrid 会跳过它 —— 不许静默）', () => {
  const r = auditRecords([{
    bed: k(1),
    wake: k(9),
    stages: [{ start: k(1), end: k(1) + 3 * 86400, state: 2 }], // 一个 stage 跨 3 天
  }]);
  assert.ok(rules(r).includes('stages.span-too-long'));
});

/* ─────────── 闸门自检：新测试文件不许变成孤儿 ─────────── */

/**
 * 2026-10-15 踩到：`npm test` 与 `scripts/verify-all.ps1` 都是**显式列举**测试文件的，
 * 而 CI 只跑 `npm test` ⇒ 新建的 `contract.test.js` 一开始**根本没被跑到**，
 * 本地手跑是绿的、闸门里等于不存在。
 *
 * ⇒ 这条自检把「新文件必须进列表」变成会失败的断言。它自己也受同一条约束（自举）。
 */
test('★ 闸门自检：每个 test/*.test.js 都必须出现在 `npm test` 里（否则 CI 不会跑它，写了等于没写）', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const files = fs.readdirSync(new URL('./', import.meta.url)).filter((f) => f.endsWith('.test.js'));
  const missing = files.filter((f) => !pkg.scripts.test.includes(f));
  assert.deepEqual(
    missing, [],
    `这些测试文件不在 npm test 里：${missing.join(', ')} —— 加进 package.json 的 scripts.test`
    + '（以及 scripts/verify-all.ps1 的 $tests 列表）',
  );
});
