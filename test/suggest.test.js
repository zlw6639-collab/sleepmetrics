import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggest, nudgeDecision, normalizeNight, DISCLAIMER,
  DEFAULT_TARGET_MINUTES, DEFAULT_LATENCY_MINUTES,
} from '../src/suggest.js';
import { minToClock } from '../src/phase.js';
import * as fx from './fixtures/synthetic.mjs';

/** 注入式休息日判定：库不认识日历，只认这个函数 */
const REST = new Set(['2026-03-07', '2026-03-08']);
const isRest = (ds) => REST.has(ds);

/** 工作日（03-02 ~ 03-06）01:00→07:00（6h）；休息日 02:00→09:00（7h） */
const records = [
  ...[2, 3, 4, 5, 6].map((n) => ({ bed: fx.at(fx.d(n), 1), wake: fx.at(fx.d(n), 7), tz: fx.TZ })),
  { bed: fx.at('2026-03-07', 2), wake: fx.at('2026-03-07', 9), tz: fx.TZ },
  { bed: fx.at('2026-03-08', 2), wake: fx.at('2026-03-08', 9), tz: fx.TZ },
];

test('明天工作日 ⇒ 目标起床取工作日中位数；建议上床 = 目标 − 450 − 15', () => {
  const r = suggest(records, { now: fx.at('2026-03-09', 20), isRest, tz: fx.TZ });
  assert.equal(r.wakeTarget, 7 * 60); // 07:00
  assert.equal(r.bedtime, (7 * 60 - DEFAULT_TARGET_MINUTES - DEFAULT_LATENCY_MINUTES + 1440) % 1440); // 23:15
  assert.equal(minToClock(r.bedtime), '23:15');
  assert.equal(r.tomorrowIsRest, false);
});

test('明天休息日 ⇒ 目标起床取休息日中位数（09:00 ⇒ 01:15 上床）', () => {
  const r = suggest(records, { now: fx.at('2026-03-06', 20), isRest, tz: fx.TZ });
  assert.equal(r.tomorrow, '2026-03-07');
  assert.equal(r.wakeTarget, 9 * 60);
  assert.equal(minToClock(r.bedtime), '01:15'); // 跨午夜：540 − 450 − 15 = 75
});

test('每条建议都带 ruleId 与触发它的数字（可追溯，不许只有结论）', () => {
  const r = suggest(records, { now: fx.at('2026-03-09', 20), isRest, tz: fx.TZ });
  assert.ok(r.reasons.length >= 2);
  for (const reason of r.reasons) {
    assert.equal(typeof reason.ruleId, 'string');
    assert.ok(reason.ruleId.length > 0);
    assert.ok(reason.numbers && typeof reason.numbers === 'object');
    assert.ok(Object.keys(reason.numbers).length > 0);
  }
  assert.deepEqual(r.reasons.map((x) => x.ruleId), ['wakeTarget.work', 'bedtime.backward']);
});

test('明天休息日但缺休息日记录 ⇒ 工作日中位数 + 40 分钟，且 ruleId 说明是兜底', () => {
  const onlyWork = [2, 3, 4, 5, 6].map((n) => ({ bed: fx.at(fx.d(n), 1), wake: fx.at(fx.d(n), 7), tz: fx.TZ }));
  const r = suggest(onlyWork, { now: fx.at('2026-03-06', 20), isRest, tz: fx.TZ });
  assert.equal(r.wakeTarget, 7 * 60 + 40);
  assert.equal(r.reasons[0].ruleId, 'wakeTarget.rest.fallback');
  assert.equal(r.reasons[0].numbers.plusMinutes, 40);
});

test('只有休息日数据、明天又是工作日 ⇒ insufficient，不硬算', () => {
  const onlyRest = [
    { bed: fx.at('2026-03-07', 2), wake: fx.at('2026-03-07', 9), tz: fx.TZ },
    { bed: fx.at('2026-03-08', 2), wake: fx.at('2026-03-08', 9), tz: fx.TZ },
  ];
  const r = suggest(onlyRest, { now: fx.at('2026-03-09', 20), isRest, tz: fx.TZ });
  assert.equal(r.insufficient, true);
  assert.equal(r.disclaimer, DISCLAIMER);
});

test('没有主睡眠 ⇒ insufficient（小睡不算主睡眠）', () => {
  const napsOnly = [{ bed: fx.at(fx.d(1), 14), wake: fx.at(fx.d(1), 15), tz: fx.TZ }];
  const r = suggest(napsOnly, { now: fx.at(fx.d(2), 20), isRest, tz: fx.TZ });
  assert.equal(r.insufficient, true);
});

test('近 7 晚的入睡点用圆周均值（不是算术平均）', () => {
  // 造两条跨午夜入睡：23:50 与 00:10 —— 算术平均会给出 12:00，圆周均值必须给 00:00
  const recs = [
    { bed: fx.at(fx.d(1), 23, 50), wake: fx.at(fx.d(2), 7, 50), tz: fx.TZ },
    { bed: fx.at(fx.d(3), 0, 10), wake: fx.at(fx.d(3), 8, 10), tz: fx.TZ },
  ];
  const r = suggest(recs, { now: fx.at(fx.d(4), 20), isRest, tz: fx.TZ });
  const mean = r.facts[0].numbers.bedtimeCircMeanMinutes;
  assert.ok(mean === 0 || mean === 1440, `实际 ${mean}`);
  assert.notEqual(mean, 720); // 算术平均会给出 720（12:00）—— 那才是错的
});

test('任何返回都带医学免责', () => {
  const ok = suggest(records, { now: fx.at('2026-03-09', 20), isRest, tz: fx.TZ });
  assert.equal(ok.disclaimer, DISCLAIMER);
  assert.equal(suggest([], {}).disclaimer, DISCLAIMER);
});

test('normalizeNight：凌晨归到「前一天深夜」，12:00 是分界', () => {
  assert.equal(normalizeNight(60), 1500); // 01:00 ⇒ 25:00
  assert.equal(normalizeNight(1430), 1430); // 23:50 不动
  assert.equal(normalizeNight(720), 720); // 12:00 正好是分界（不 +24h）
});

test('催睡闸门：时段内 + 超 30 分钟 + 今天没说过 ⇒ 允许', () => {
  // 建议 23:15 上床，现在 00:05（次日）⇒ 超 50 分钟
  const d = nudgeDecision({ nowMinutes: 5, bedtimeMinutes: 23 * 60 + 15, saidToday: 0 });
  assert.equal(d.allowed, true);
  assert.equal(d.ruleId, 'nudge.allowed');
  assert.equal(d.deltaMinutes, 50);
});

test('催睡闸门：三种拒绝各有自己的 ruleId', () => {
  const outside = nudgeDecision({ nowMinutes: 18 * 60, bedtimeMinutes: 23 * 60, saidToday: 0 });
  assert.equal(outside.ruleId, 'nudge.outside-window');
  assert.equal(outside.allowed, false);

  const early = nudgeDecision({ nowMinutes: 23 * 60 + 10, bedtimeMinutes: 23 * 60, saidToday: 0 });
  assert.equal(early.ruleId, 'nudge.too-early'); // 只超 10 分钟 < 30

  const said = nudgeDecision({ nowMinutes: 5, bedtimeMinutes: 23 * 60 + 15, saidToday: 1 });
  assert.equal(said.ruleId, 'nudge.already-said');
});

test('催睡闸门：21:00 与 06:00 是边界（含端点）', () => {
  assert.equal(nudgeDecision({ nowMinutes: 21 * 60, bedtimeMinutes: 20 * 60, saidToday: 0 }).allowed, true);
  assert.equal(nudgeDecision({ nowMinutes: 6 * 60, bedtimeMinutes: 23 * 60, saidToday: 0 }).allowed, true);
  assert.equal(nudgeDecision({ nowMinutes: 6 * 60 + 1, bedtimeMinutes: 23 * 60, saidToday: 0 }).allowed, false);
});
