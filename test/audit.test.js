import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditRecords } from '../src/audit.js';
import * as fx from './fixtures/synthetic.mjs';

/** 一份干净数据：两晚 01:00→09:00，第一晚带合法 stages */
const good = () => [
  {
    bed: fx.at(fx.d(1), 1),
    wake: fx.at(fx.d(1), 9),
    tz: fx.TZ,
    stages: [
      { start: fx.at(fx.d(1), 1), end: fx.at(fx.d(1), 3), state: 2 },
      { start: fx.at(fx.d(1), 3), end: fx.at(fx.d(1), 9), state: 3 },
    ],
  },
  { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9), tz: fx.TZ },
];

const rules = (r) => r.issues.map((x) => x.ruleId);

/* ─────────── 喂脏：体检工具自己不许先倒下（2026-10-13 实测修）─────────── */

test('★ audit：tz 不是数字时报 tz.not-a-number，而不是抛 RangeError（它是防脏的最后一道）', () => {
  let r;
  assert.doesNotThrow(() => {
    r = auditRecords([{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: 'xx' }]);
  });
  // 崩因：`dayOf(wake, 'xx')` → `'xx' * 3600` = NaN → `new Date(NaN).toISOString()` → RangeError
  assert.ok(rules(r).includes('tz.not-a-number'));
  assert.equal(r.summary.records, 1); // 记录仍被收下（按默认 tz 计算），不是被丢掉
  assert.equal(r.summary.days, 1);
});

test('audit：dur 不是数字要报出来（原先整段被跳过 ⇒ 静默无报）；null 视为「未给」而不是 0 分钟', () => {
  const bad = auditRecords([{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), dur: 'abc' }]);
  assert.ok(rules(bad).includes('dur.not-a-number'));

  const nil = auditRecords([{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), dur: null }]);
  assert.ok(!rules(nil).includes('dur.not-a-number'));
  assert.ok(!rules(nil).includes('dur.too-short'), 'null 不该被当成 0 分钟');
});

test('★ audit：tz 超出合理范围 ⇒ error 级 tz.out-of-range（量纲错误不许只给 warn）', () => {
  let r;
  assert.doesNotThrow(() => {
    r = auditRecords([
      { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: 480 },
      { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9), tz: 25 },
    ]);
  });
  const hit = r.issues.filter((x) => x.ruleId === 'tz.out-of-range');
  assert.equal(hit.length, 2);
  assert.equal(hit[0].severity, 'error');
  assert.ok(!rules(r).includes('tz.not-a-number'), '是数但超范围，不该被说成「不是数字」');
  assert.equal(r.summary.ok, false, '有 error ⇒ ok 必须为 false');
  // ★ 体检工具不许被脏数据搞崩：记录仍被收下、日期仍算得出来（按默认 tz）
  assert.equal(r.summary.records, 2);
  assert.equal(r.summary.days, 2);
});

test('audit：范围**内**的小数 / 边界时区不许被这次收紧误伤', () => {
  // ⚠️ 三条记录用**同一个** tz：混用不同 tz 会（正确地）触发 `tz.mixed`，那是另一条规则
  const r = auditRecords([
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: -12 },
    { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9), tz: -12 },
    { bed: fx.at(fx.d(3), 1), wake: fx.at(fx.d(3), 9), tz: -12 },
  ]);
  assert.equal(r.issues.length, 0, `不该报任何问题，实际：${JSON.stringify(rules(r))}`);
  assert.equal(r.summary.ok, true);

  for (const ok of [-12, 14, 5.75, 0, 8]) {
    const one = auditRecords([{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: ok }]);
    assert.ok(!rules(one).includes('tz.out-of-range'), `tz=${ok} 是合法时区，不该报超范围`);
  }
});

/* ─────────── stages 编码：数值合法 ≠ 语义正确（2026-10-14 外部评审）─────────── */

test('★ stages.no-awake：样本够却一个清醒段都没有 ⇒ 开口，且必须给两种解释（不断言）', () => {
  // 12 晚，每晚 deep→light→REM，全程没有 state=5
  const recs = Array.from({ length: 12 }, (_, i) => ({
    bed: fx.at(fx.d(i + 1), 1),
    wake: fx.at(fx.d(i + 1), 9),
    tz: fx.TZ,
    stages: [
      { start: fx.at(fx.d(i + 1), 1), end: fx.at(fx.d(i + 1), 3), state: 2 },
      { start: fx.at(fx.d(i + 1), 3), end: fx.at(fx.d(i + 1), 7), state: 3 },
      { start: fx.at(fx.d(i + 1), 7), end: fx.at(fx.d(i + 1), 9), state: 4 },
    ],
  }));
  const hit = auditRecords(recs).issues.find((x) => x.ruleId === 'stages.no-awake');
  assert.ok(hit, '应当报 stages.no-awake');
  // 这条规则只能"提示"不能"判决" ⇒ 两种解释缺一不可
  assert.ok(hit.message.includes('确实整夜没醒'), '必须保留「真没醒」这种解释');
  assert.ok(hit.message.includes('编码'), '必须提到「编码可能不匹配」');
});

test('stages.no-awake 的判据刻意保守：样本不足时不开口（2~3 晚说明不了任何事）', () => {
  const recs = Array.from({ length: 3 }, (_, i) => ({
    bed: fx.at(fx.d(i + 1), 1),
    wake: fx.at(fx.d(i + 1), 9),
    tz: fx.TZ,
    stages: [{ start: fx.at(fx.d(i + 1), 1), end: fx.at(fx.d(i + 1), 9), state: 2 }],
  }));
  assert.ok(!rules(auditRecords(recs)).includes('stages.no-awake'));
});

test('stages.no-awake：只要出现过一条 state=5 就不报（它拦的是「整份都没有」）', () => {
  const recs = Array.from({ length: 12 }, (_, i) => ({
    bed: fx.at(fx.d(i + 1), 1),
    wake: fx.at(fx.d(i + 1), 9),
    tz: fx.TZ,
    stages: [{ start: fx.at(fx.d(i + 1), 1), end: fx.at(fx.d(i + 1), 9), state: i === 0 ? 5 : 2 }],
  }));
  assert.ok(!rules(auditRecords(recs)).includes('stages.no-awake'));
});

test('★ 编码错位：越界的抓得到，落在 2/3/4/5 内却语义不同的抓不到 —— 把这条边界钉下来', () => {
  const base = (stateFor8to9) => Array.from({ length: 12 }, (_, i) => ({
    bed: fx.at(fx.d(i + 1), 1),
    wake: fx.at(fx.d(i + 1), 9),
    tz: fx.TZ,
    stages: [
      { start: fx.at(fx.d(i + 1), 1), end: fx.at(fx.d(i + 1), 8), state: 2 },
      { start: fx.at(fx.d(i + 1), 8), end: fx.at(fx.d(i + 1), 9), state: stateFor8to9 },
    ],
  }));

  // ① 用 AASM 的 0 表示清醒 ⇒ 越界 ⇒ unknown-state 抓得到
  const outOfRange = auditRecords(base(0));
  assert.ok(rules(outOfRange).includes('stages.unknown-state'), '越界的 0 必须被报出来');

  // ② 换成「4 表示清醒」（4 在本库是 REM，落在合法区间）⇒ unknown-state 抓不到……
  const inRange = auditRecords(base(4));
  assert.ok(!rules(inRange).includes('stages.unknown-state'), '4 在合法区间内 ⇒ unknown-state 抓不到');
  // ……但整份数据**一个 5 都没有** ⇒ `no-awake` 把它兜住了。
  // ⇒ 这是 `stages.no-awake` 的**间接价值**：绝大多数「清醒码错位」都会以"缺 5"的形式暴露出来。
  assert.ok(rules(inRange).includes('stages.no-awake'), '缺 5 ⇒ 由 no-awake 兜住');

  // ③ 真正抓不到的那一类：错位之后**仍然存在 state=5**（只是 5 在那套编码里是别的意思）。
  //    例：某来源 1=deep 2=light 3=REM 4=awake 5=artefact ⇒ 区间内合法、且 5 存在。
  const sneaky = base(2).map((r, i) => ({
    ...r,
    stages: i === 0
      ? [...r.stages, { start: fx.at(fx.d(1), 9), end: fx.at(fx.d(1), 9) + 60, state: 5 }]
      : r.stages,
  }));
  const r3 = auditRecords(sneaky);
  assert.ok(!rules(r3).includes('stages.no-awake'), '有 5 ⇒ no-awake 不响');
  assert.ok(!rules(r3).includes('stages.unknown-state'), '全在区间内 ⇒ unknown-state 不响');
  // ⇒ 这就是「数值合法 ≠ 语义正确」的最后一块：**类型系统拦不住、audit 也拦不住，只有文档能**
  //   （README §Input shape 那段警告 + "喂之前先映射、先核对 awake 码"）。
});

test('干净数据：零问题，ok = true', () => {
  const r = auditRecords(good());
  assert.deepEqual(r.issues, []);
  assert.equal(r.summary.ok, true);
  assert.equal(r.summary.records, 2);
  assert.equal(r.summary.days, 2);
  assert.equal(r.summary.daysWithoutMainSleep, 0);
});

test('把毫秒当秒传 ⇒ error（这是最常见的坑）', () => {
  const r = auditRecords([{ bed: fx.at(fx.d(1), 1) * 1000, wake: fx.at(fx.d(1), 9) * 1000 }]);
  assert.ok(rules(r).includes('time.looks-like-milliseconds'));
  assert.equal(r.summary.ok, false);
  assert.ok(r.summary.bySeverity.error >= 1);
});

test('wake 不晚于 bed ⇒ error', () => {
  const r = auditRecords([{ bed: fx.at(fx.d(1), 9), wake: fx.at(fx.d(1), 1) }]);
  assert.ok(rules(r).includes('time.wake-not-after-bed'));
});

test('dur 超过卧床时长 ⇒ warn（真矛盾）', () => {
  const r = auditRecords([{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), dur: 999 }]);
  assert.ok(rules(r).includes('dur.exceeds-time-in-bed'));
  assert.equal(r.summary.bySeverity.warn, 1);
});

test('dur 小于卧床时长 ⇒ **不是**错误（那是睡眠效率），但差得多时给 info', () => {
  // 卧床 8h、实睡 6h20 ⇒ 差 100 分钟 < 120 ⇒ 连 info 都不给
  const near = auditRecords([{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), dur: 380 }]);
  assert.equal(near.issues.length, 0);

  // 卧床 8h、实睡 4h ⇒ 差 240 分钟 ⇒ 给一条 info（不是 error/warn）
  const far = auditRecords([{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), dur: 240 }]);
  assert.equal(far.summary.bySeverity.error, 0);
  assert.equal(far.summary.bySeverity.warn, 0);
  assert.ok(rules(far).includes('dur.much-shorter-than-time-in-bed'));
});

test('完全相同的两条 ⇒ warn（重复）', () => {
  const one = { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9) };
  const r = auditRecords([one, { ...one }]);
  assert.ok(rules(r).includes('record.duplicate'));
});

test('两条记录时段重叠 ⇒ warn', () => {
  const r = auditRecords([
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9) },
    { bed: fx.at(fx.d(1), 8), wake: fx.at(fx.d(1), 12) }, // 与上一条重叠 1 小时
  ]);
  assert.ok(rules(r).includes('records.overlap'));
});

test('stages：state 编码不认识 / 段与段重叠 ⇒ 各有 warn', () => {
  const r = auditRecords([{
    bed: fx.at(fx.d(1), 1),
    wake: fx.at(fx.d(1), 9),
    stages: [
      { start: fx.at(fx.d(1), 1), end: fx.at(fx.d(1), 5), state: 9 }, // 未知编码
      { start: fx.at(fx.d(1), 4), end: fx.at(fx.d(1), 9), state: 3 }, // 与上一段重叠
    ],
  }]);
  assert.ok(rules(r).includes('stages.unknown-state'));
  assert.ok(rules(r).includes('stages.overlap'));
});

test('只有小睡、没有主睡眠的日子会被数出来（并给 info，不是 error）', () => {
  const r = auditRecords([
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9) },
    { bed: fx.at(fx.d(2), 14), wake: fx.at(fx.d(2), 15) }, // 该日无主睡眠
  ]);
  assert.equal(r.summary.daysWithoutMainSleep, 1);
  const hit = r.issues.find((x) => x.ruleId === 'days.no-main-sleep');
  assert.equal(hit.severity, 'info');
  assert.match(hit.message, /2026-03-02/);
});

test('跨时区混排 ⇒ warn（提醒确认是有意的）', () => {
  const r = auditRecords([
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: 8 },
    { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9), tz: 0 },
  ]);
  assert.ok(rules(r).includes('tz.mixed'));
});

test('输入不是数组 ⇒ 返回 error 而不是抛异常', () => {
  const r = auditRecords(null);
  assert.equal(r.summary.ok, false);
  assert.ok(rules(r).includes('input.not-array'));
  const r2 = auditRecords([null, 'x', 42]);
  assert.equal(r2.summary.bySeverity.error, 3);
});

test('每条问题都带 ruleId + severity + 人类可读的 message（可机读也可人读）', () => {
  const r = auditRecords([{ bed: 0, wake: 0 }]);
  assert.ok(r.issues.length > 0);
  for (const it of r.issues) {
    assert.equal(typeof it.ruleId, 'string');
    assert.ok(['error', 'warn', 'info'].includes(it.severity));
    assert.equal(typeof it.message, 'string');
    assert.ok(it.message.length > 0);
  }
});
