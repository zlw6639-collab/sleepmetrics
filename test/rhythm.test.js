import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeIS, computeIV } from '../src/rhythm.js';

const PER_DAY = 4; // 用小 perDay 便于手算：一天 4 个点

test('IS：每天都一样 ⇒ IS = 1（完全稳定）', () => {
  const r = computeIS([0, 1, 0, 1, 0, 1, 0, 1], { perDay: PER_DAY }); // 两天完全相同
  assert.equal(r.days, 2);
  assert.ok(Math.abs(r.is - 1) < 1e-12, `实际 ${r.is}`);
});

test('IS：天与天差别越大 ⇒ IS 越小', () => {
  const same = computeIS([0, 1, 0, 1, 0, 1, 0, 1], { perDay: PER_DAY }).is;
  const flipped = computeIS([0, 1, 0, 1, 1, 0, 1, 0], { perDay: PER_DAY }).is; // 第二天反相
  assert.ok(flipped < same, `${flipped} 应小于 ${same}`);
  assert.ok(flipped >= 0);
});

test('IS：整数天是硬要求 —— 不是整天就返回 null（同一时刻对不齐）', () => {
  assert.equal(computeIS([0, 1, 0, 1, 0], { perDay: PER_DAY }), null); // 5 个点 ≠ 整天
  assert.equal(computeIS([0, 1, 0, 1], { perDay: PER_DAY }), null); // 只有一天
});

test('IS：全零序列 / 含 NaN / 非法 perDay ⇒ null（把"无定义"和"0"分开）', () => {
  assert.equal(computeIS([0, 0, 0, 0, 0, 0, 0, 0], { perDay: PER_DAY }), null);
  assert.equal(computeIS([0, 1, NaN, 1, 0, 1, 0, 1], { perDay: PER_DAY }), null);
  assert.equal(computeIS([0, 1, 0, 1, 0, 1, 0, 1], { perDay: 1 }), null);
  assert.equal(computeIS([], { perDay: PER_DAY }), null);
});

test('IV：常数序列 ⇒ null（不是"变异为 0"，而是比值没有意义）', () => {
  assert.equal(computeIV([5, 5, 5, 5, 5]), null);
});

test('IV：相邻变化越多越大 ⇒ IV 越大', () => {
  const flat = computeIV([0, 0, 0, 0, 1, 0, 0, 0]).iv; // 一次跳变
  const choppy = computeIV([0, 1, 0, 1, 0, 1, 0, 1]).iv; // 一路跳
  assert.ok(choppy > flat, `${choppy} 应大于 ${flat}`);
});

test('IV：太短（<3 点）或含非法值 ⇒ null', () => {
  assert.equal(computeIV([1, 2]), null);
  assert.equal(computeIV([1, 2, Number.POSITIVE_INFINITY]), null);
  assert.equal(computeIV(null), null);
});

test('★ 口径警告必须留在源码里（防后人"顺手删掉"）', () => {
  const src = fs.readFileSync(new URL('../src/rhythm.js', import.meta.url), 'utf8');
  assert.match(src, /活动计数|activity counts/, '必须写明定义建立在 activity counts 上');
  assert.match(src, /退化形式/, '必须写明二值序列得到的是退化形式');
  assert.match(src, /不可.*比较|不可互相比较/, '必须写明两种口径不可比较');
  assert.match(src, /不做.*换算|不做\*\*任何换算/, '必须写明不做换算/归一化');
});

/* ─────────── IS 的分子分母**都要减全体均值**（2026-10-15 修）─────────── */

/**
 * 逐行翻译自 `cran/nparACT/R/nparACT_ISIVfunctions.R` 的 `nparACT_IS()`：
 *
 *   IS = n · Σ_h (x̄_h − x̄)² / ( p · Σ_i (x_i − x̄)² )
 *
 * 参考实现是**独立副本**（不同语言、不同作者），所以能当对照。实测四条序列里
 * `computeIV` 与它**逐位一致**，而 `computeIS` 只在平凡情形上碰巧一致 —— 那就是漏了中心化。
 */
const refIS = (values, perDay) => {
  const n = values.length;
  const days = n / perDay;
  const meanAll = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  for (let h = 0; h < perDay; h += 1) {
    let s = 0;
    for (let d = 0; d < days; d += 1) s += values[d * perDay + h];
    num += ((s / days) - meanAll) ** 2;
  }
  let den = 0;
  for (const v of values) den += (v - meanAll) ** 2;
  return (n * num) / (perDay * den);
};

test('★ IS 必须减全体均值 —— 不减的话「高基线 + 两天反相」会假报完美规律', () => {
  // 每天 4 个点，两天的模式**完全相反**，但每个时刻的日均值都恰好等于全体均值 1000
  // ⇒ 日间稳定性 = 0（"每天同一时刻没有系统性差异"）
  // ⇒ 不减均值时只拿到二阶矩，会给出 1.0000 —— 一个看着像"完美规律"的胡说值。
  const v = [1000, 1005, 1000, 995, 1000, 995, 1000, 1005];
  const r = computeIS(v, { perDay: PER_DAY });
  assert.equal(r.is, 0, `实际 ${r.is} —— 未减均值时会给出接近 1 的假高分`);
});

test('★ IS 与 nparACT 参考实现一致（IV 本来就一致，可作为参照组）', () => {
  const cases = [
    [1, 2, 3, 4, 1, 2, 3, 4],
    [1, 2, 3, 4, 4, 3, 2, 1],
    [1000, 1005, 1000, 995, 1000, 995, 1000, 1005],
    [3, 7, 2, 9, 5, 1, 8, 4],
    [0, 1, 0, 1, 1, 0, 1, 0],
  ];
  for (const v of cases) {
    const mine = computeIS(v, { perDay: PER_DAY }).is;
    const want = refIS(v, PER_DAY);
    assert.ok(
      Math.abs(mine - want) < 1e-12,
      `IS 与 nparACT 不一致：本库 ${mine}，参考 ${want}（序列 ${JSON.stringify(v)}）`,
    );
  }
});
