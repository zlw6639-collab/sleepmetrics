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
import {
  computeSRI, sriLastN, sriLeaveOneOut, computeIS, computeIV, computePhase, chronotype,
  compareChronotype, suggest, nudgeDecision, dayOf,
} from '../src/index.js';
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
test('★ 闸门自检：每个 test/*.test.js 都会被 `npm test` 跑到（否则 CI 不会跑它，写了等于没写）', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const files = fs.readdirSync(new URL('./', import.meta.url)).filter((f) => f.endsWith('.test.js'));
  // `npm test` 现在跑 `scripts/test-all.mjs`，它**自动发现**测试文件 ⇒ 天生没有孤儿。
  // 万一有人把它改回显式列举，下面那条检查立刻恢复作用。
  if (pkg.scripts.test.includes('test-all')) {
    assert.ok(files.length > 0, '一个测试文件都没发现 —— 先怀疑尺子（路径或后缀）');
    return;
  }
  const missing = files.filter((f) => !pkg.scripts.test.includes(f));
  assert.deepEqual(
    missing, [],
    `这些测试文件不在 npm test 里：${missing.join(', ')} —— 加进 package.json 的 scripts.test`
    + '（以及 scripts/verify-all.ps1 的 $tests 列表）',
  );
});

/* ─────────── 公开入口的参数契约（配置 vs 数据）─────────── */

/**
 * 2026-10-15 复核：公开入口对**配置参数**的处理原来各写各的 ——
 *   · `auditRecords(recs, null)` / `suggest(recs, null)` / `computeSRI(recs, null)` / `chronotype(v, null)`
 *     全都抛 `TypeError`（默认参数 `= {}` 只覆盖 `undefined`，**不覆盖显式 `null`**）；
 *   · `normalize(recs, 'xx')` / `computeSRI(recs, {tz: 'xx'})` 抛 `RangeError: Invalid time value`
 *     （`'xx' * 3600` = NaN ⇒ `new Date(NaN).toISOString()`）。
 *
 * 两条契约，都刻意**与「数据不合法」的处理相反**：
 *   ① **选项对象是 `null` / `undefined` ⇒ 视同「未给」**，用默认值。
 *      先例：`dur: null` 已被 `auditRecords()` 当作「未给」，而不是 0 分钟。
 *   ② **`tz` 不合法 ⇒ 抛 `TypeError`**，而不是静默回退。理由：`tz` 是**配置**不是数据 ——
 *      数据不合法就返回 `null` / `[]`（不猜），但配置悄悄回退会**按另一个时区算**，
 *      而差一个时区就可能在「跨午夜归哪一天」上差一天，**任何断言都看不见它**。
 *      ⇒ 配置错误宁可可见地失败。
 */

test('★ 显式 null 的选项对象 ⇒ 视同「未给」，不抛（原来全是 TypeError）', () => {
  const recs = [{ bed: k(1), wake: k(9) }];
  assert.doesNotThrow(() => normalize(recs, null));
  assert.doesNotThrow(() => auditRecords(recs, null));
  assert.doesNotThrow(() => suggest(recs, null));
  assert.doesNotThrow(() => computeSRI(recs, null));
  assert.doesNotThrow(() => sriLastN(recs, recs, 7, null));
  assert.doesNotThrow(() => sriLeaveOneOut(recs, recs, 7, null));
  assert.doesNotThrow(() => computeIS([1, 2, 3, 4], null));
  assert.doesNotThrow(() => computePhase(recs, () => false, null));
  assert.doesNotThrow(() => chronotype(3, null));
  assert.doesNotThrow(() => compareChronotype(null));
  assert.doesNotThrow(() => nudgeDecision(null));
  // 而且真的用了默认值 —— 不是「没抛就算过」
  assert.equal(normalize(recs, null)[0].tz, 8);
  assert.equal(auditRecords(recs, null).summary.records, 1);
});

test('★ tz 不合法 ⇒ 抛明确的 TypeError（配置错误必须可见，不许静默换个时区算）', () => {
  const recs = [{ bed: k(1), wake: k(9) }];
  for (const bad of ['xx', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    const label = String(bad);
    assert.throws(() => normalize(recs, bad), /tz 必须是有限数/, `normalize tz=${label}`);
    assert.throws(() => buildGrid(recs, bad), /tz 必须是有限数/, `buildGrid tz=${label}`);
    assert.throws(() => computeSRI(recs, { tz: bad }), /tz 必须是有限数/, `computeSRI tz=${label}`);
    assert.throws(() => auditRecords(recs, { tz: bad }), /tz 必须是有限数/, `auditRecords tz=${label}`);
    assert.throws(() => computePhase(recs, () => false, { tz: bad }), /tz 必须是有限数/, `computePhase tz=${label}`);
    assert.throws(() => suggest(recs, { tz: bad }), /tz 必须是有限数/, `suggest tz=${label}`);
    assert.throws(() => dayOf(0, bad), /tz 必须是有限数/, `dayOf tz=${label}`);
  }
});

test('★ 合法 tz 不许被这次收紧误伤（0 / 负数 / 半小时时区 / 字符串数字都算数）', () => {
  const recs = [{ bed: k(1), wake: k(9) }];
  assert.equal(normalize(recs)[0].tz, 8);         // 省略 ⇒ 默认
  assert.equal(normalize(recs, null)[0].tz, 8);   // null ⇒ 默认
  assert.equal(normalize(recs, 0)[0].tz, 0);      // ⚠️ 0 是合法时区（UTC），不是「空值」
  assert.equal(normalize(recs, -5)[0].tz, -5);
  assert.equal(normalize(recs, 5.5)[0].tz, 5.5);  // 印度 (+5:30) / 尼泊尔 (+5:45) 那类偏移
  assert.equal(normalize(recs, '8')[0].tz, 8);    // 字符串数字 —— 与「记录级 tz」同一口径
  // 记录级 tz 不合法时**仍然回退**（那条路径有 `tz.not-a-number` 把它报出来，所以回退是可见的）
  assert.equal(normalize([{ ...recs[0], tz: 'xx' }])[0].tz, 8);
});

/* ─────────── SRI 的日界线：整段一个参考时区 ─────────── */

/** 当地某日 `h` 点 → epoch 秒（写测试时手算跨时区用例用） */
const localAt = (tz, h, ds) => Date.parse(`${ds}T00:00:00Z`) / 1000 - tz * 3600 + h * 3600;

test('★ SRI 网格：`tz` 缺省时从记录推断（不写死 +8）—— 否则全是 +12 的数据会被静默挪 12 小时', () => {
  const fiji = [
    { bed: localAt(12, 1, '2026-03-01'), wake: localAt(12, 9, '2026-03-01'), tz: 12 },
    { bed: localAt(12, 1, '2026-03-02'), wake: localAt(12, 9, '2026-03-02'), tz: 12 },
  ];
  assert.equal(
    computeSRI(fiji).sri,
    computeSRI(fiji, { tz: 12 }).sri,
    '不传 tz 必须等价于传「记录里那个 tz」',
  );
  assert.notEqual(computeSRI(fiji).sri, computeSRI(fiji, { tz: 8 }).sri, '推断若失效，它会用 +8 切日');
});

test('★ 跨时区旅行：SRI 不许接近满分 —— 那意味着网格按记录各切各的了', () => {
  // 头两晚伦敦（tz=0）、后两晚斐济（tz=+12），**每一地当地都是 01:00→09:00**。
  // ⚠️ 这是反面教材的守卫：按记录各切各的会得到 **100.0**（"完美规律"），
  //    而他实际的绝对入睡时刻从 UTC 01:00 跳到了 UTC 13:00 —— 跨了 12 小时。
  //    SRI 的比较单位是「相隔 24h 的同一钟点」，各切各的就把这个前提破坏了。
  const trip = [
    { bed: localAt(0, 1, '2026-03-01'), wake: localAt(0, 9, '2026-03-01'), tz: 0 },
    { bed: localAt(0, 1, '2026-03-02'), wake: localAt(0, 9, '2026-03-02'), tz: 0 },
    { bed: localAt(12, 1, '2026-03-03'), wake: localAt(12, 9, '2026-03-03'), tz: 12 },
    { bed: localAt(12, 1, '2026-03-04'), wake: localAt(12, 9, '2026-03-04'), tz: 12 },
  ];
  const r = computeSRI(trip);
  assert.ok(r.sri !== null, '应当算得出来（有 3~4 个有效天）');
  assert.ok(r.sri < 90, `实际 ${r.sri} —— 接近 100 就说明网格按记录各切各的了`);
});

/* ─────────── 同一个函数不许有两个语义（B2）─────────── */

test('★ buildGrid：分期全无效时回退到整段 —— 直接调用与经 normalize() 必须同语义', () => {
  const withBadStages = [{ bed: k(1), wake: k(9), stages: [null] }];
  const direct = buildGrid(withBadStages);
  const viaNormalize = buildGrid(normalize(withBadStages, TZ), TZ);
  const asleep = (g) => {
    let n = 0;
    for (const a of g.values()) for (const v of a) if (v) n += 1;
    return n;
  };
  assert.equal(direct.size, 1, '直接调用不该把整段睡眠静默丢掉（原来这里是 0 天）');
  assert.equal(viaNormalize.size, 1);
  assert.equal(asleep(direct), asleep(viaNormalize), '两条路径必须标记同样多的分钟');
  assert.equal(asleep(direct), 480);
});

/* ─────────── IS / IV：有限输入不许产出 NaN（A4）─────────── */

test('★ IS / IV：极端但有限的输入 ⇒ null（原来返回 NaN —— 一个看着像数的东西）', () => {
  assert.equal(computeIS([1e308, -1e308, 1e308, -1e308], { perDay: 2 }), null);
  assert.equal(computeIS([1e200, 1e200, 1e200, 1e200], { perDay: 2 }), null);
  assert.equal(computeIV([1e308, -1e308, 1e308]), null);
  // 正常输入不许被这次收紧误伤
  const ok = computeIS([1, 2, 3, 4], { perDay: 2 });
  assert.ok(ok !== null && Number.isFinite(ok.is), '正常序列仍要算得出来');
  const okIv = computeIV([1, 2, 3]);
  assert.ok(okIv !== null && Number.isFinite(okIv.iv));
});
