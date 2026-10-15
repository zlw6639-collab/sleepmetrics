import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circMean, circDiff, circStats, dayOf, clockMin, dayStartSec, SEC_PER_DAY, isPlausibleTz, resolveTz } from '../src/time.js';

test('circDiff：跨午夜走 shorter 口径（10 与 1430 相差 20 分钟，不是 -1420）', () => {
  assert.equal(circDiff(10, 1430), 20);
  assert.equal(circDiff(1430, 10), -20);
  assert.equal(circDiff(0, 0), 0);
  assert.equal(circDiff(720, 0), 720);
});

test('circMean：23:50 与 00:10 的均值是 00:00（线性平均会算成 12:00）', () => {
  const m = circMean([1430, 10]);
  assert.ok(Math.abs(circDiff(m, 0)) < 1e-6, `实际 ${m}（绕环距 0 点 ${circDiff(m, 0)} 分钟）`);
  // 反面教材：算术平均给出 720 = 12:00
  assert.equal((1430 + 10) / 2, 720);
});

test('circMean：单点原样返回；空输入返回 null', () => {
  assert.ok(Math.abs(circDiff(circMean([123]), 123)) < 1e-9);
  assert.equal(circMean([]), null);
});

test('dayOf / clockMin 按传入 tz 归日，不写死 +8', () => {
  const ts = Date.parse('2026-03-01T23:30:00+08:00') / 1000;
  assert.equal(dayOf(ts, 8), '2026-03-01');
  assert.equal(clockMin(ts, 8), 23 * 60 + 30);
  assert.equal(dayOf(ts, 0), '2026-03-01'); // UTC 下是 15:30，仍是同日
  assert.equal(clockMin(ts, 0), 15 * 60 + 30);
});

test('dayStartSec 与 dayOf 互为逆（tz=8）', () => {
  const start = dayStartSec('2026-03-05', 8);
  assert.equal(dayOf(start, 8), '2026-03-05');
  assert.equal(dayOf(start - 1, 8), '2026-03-04');
  assert.equal(dayStartSec('2026-03-06', 8) - start, SEC_PER_DAY);
});

test('circStats：完全一致的一组 ⇒ R = 1、sd ≈ 0', () => {
  const s = circStats([120, 120, 120, 120]);
  assert.equal(s.n, 4);
  assert.ok(Math.abs(circDiff(s.mean, 120)) < 1e-9);
  assert.ok(s.sd < 1e-9);
  assert.ok(Math.abs(s.R - 1) < 1e-9);
});

test('circStats：跨午夜的一组也能给出正确均值与合理离散度', () => {
  const s = circStats([1430, 10]); // 23:50 与 00:10
  assert.ok(Math.abs(circDiff(s.mean, 0)) < 1e-6);
  assert.ok(s.sd > 0 && s.sd < 60); // 两点相隔 20 分钟 ⇒ 标准差应在几十分钟内
  assert.ok(s.R > 0 && s.R < 1);
});

test('circStats：接近均匀分布 ⇒ sd = null（宁可说"没有意义"，也不给像数的胡说值）', () => {
  const s = circStats([0, 360, 720, 1080]); // 四个正交方向 ⇒ R = 0
  assert.equal(s.sd, null);
  assert.ok(s.R < 1e-9);
});

test('circStats：空输入 ⇒ 全 null', () => {
  assert.deepEqual(circStats([]), { n: 0, mean: null, sd: null, R: null });
});

/* ─────────── tz 的合理范围：判据只有一处（2026-10-15 收紧）─────────── */

test('★ isPlausibleTz：只认真实世界的极值 [−12, +14]，边界本身算数', () => {
  assert.equal(isPlausibleTz(0), true);
  assert.equal(isPlausibleTz(8), true);
  assert.equal(isPlausibleTz(-12), true); // 最西（Baker Island / AoE）
  assert.equal(isPlausibleTz(14), true);  // 最东（Kiritimati）
  assert.equal(isPlausibleTz(5.75), true); // 尼泊尔 +5:45 那种 15 分钟粒度
  assert.equal(isPlausibleTz('8'), true); // 字符串数字与「记录级 tz」同口径
  assert.equal(isPlausibleTz(14.5), false);
  assert.equal(isPlausibleTz(-12.5), false);
  assert.equal(isPlausibleTz(25), false);
  assert.equal(isPlausibleTz(480), false); // ← 把「分钟」当小时：最常见的量纲错误
  assert.equal(isPlausibleTz(Number.NaN), false);
  assert.equal(isPlausibleTz(Number.POSITIVE_INFINITY), false);
  // ★ 缺省不是时区：`Number(null)` 是 0、`Number('')` 也是 0 —— 照收就会把「未给」变成 UTC+0，
  //   而 `resolveTz(null)` 的语义是「用默认值」。两边必须一致，否则同一条记录会有两个时区。
  assert.equal(isPlausibleTz(null), false);
  assert.equal(isPlausibleTz(undefined), false);
  assert.equal(isPlausibleTz(''), false);
  assert.equal(isPlausibleTz('  '), false);
  assert.equal(isPlausibleTz([]), false);
  assert.equal(isPlausibleTz({}), false);
  assert.equal(isPlausibleTz(true), false);
});

test('★ resolveTz：不合理的时区**抛**，而不是回退（静默回退 = 换一个时区继续算）', () => {
  // 为什么不能容忍：`tz: 480` 会让 dayOf() 平移 20 天，日期全错、数字照出、任何断言看不见
  assert.throws(() => resolveTz(480, 'x'), /超出合理时区范围/);
  assert.throws(() => resolveTz(25, 'x'), /超出合理时区范围/);
  assert.throws(() => resolveTz(-13, 'x'), /超出合理时区范围/);
  assert.throws(() => resolveTz(14.5, 'x'), /超出合理时区范围/);
  // 错误消息必须同时说清「收到了什么」与「该给什么」，否则用户只看到一句拒绝
  assert.throws(() => resolveTz(480, 'dayOf'), /dayOf/);
  assert.throws(() => resolveTz(480, 'dayOf'), /\[-12, 14\]/);
  // 边界值不许被误伤
  assert.equal(resolveTz(-12, 'x'), -12);
  assert.equal(resolveTz(14, 'x'), 14);
  assert.equal(resolveTz(null, 'x'), 8);   // null ⇒ 未给 ⇒ 默认值
  assert.equal(resolveTz(undefined, 'x'), 8);
  assert.equal(resolveTz(undefined, 'x', 0), 0);
});

test('dayOf / clockMin：tz 不合理时抛，而不是给出一个平移过的日期', () => {
  const ts = Date.parse('2026-03-01T23:30:00+08:00') / 1000;
  // 480 小时 = 20 天：若被接受，这一天会被归到 2026-03-21
  assert.throws(() => dayOf(ts, 480), /超出合理时区范围/);
  assert.throws(() => clockMin(ts, 480), /超出合理时区范围/);
  assert.throws(() => dayStartSec('2026-03-01', 480), /超出合理时区范围/);
  // 同一时刻在合法时区下仍然照常工作
  assert.equal(dayOf(ts, 8), '2026-03-01');
  assert.equal(dayOf(ts, 14), '2026-03-02'); // +14 ⇒ 次日 05:30
});
