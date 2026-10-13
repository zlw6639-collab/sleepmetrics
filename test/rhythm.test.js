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
