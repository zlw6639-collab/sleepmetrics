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
