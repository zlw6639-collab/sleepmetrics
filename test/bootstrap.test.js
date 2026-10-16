/**
 * `sriBootstrap()` 的规格 —— **测试名就是规格**（`AGENTS.md` 硬规矩 2）。
 *
 * 这里最重要的一条不是"区间算得对不对"，而是**重抽样的单位**：
 * `ROADMAP.md` 的 bootstrap 条目记着一个陷阱 —— 按 epoch 重抽样会得到**假窄**的区间。
 * 所以本文件里有一条测试**专门**把两种口径摆在一起对拍（epoch 那一半是测试里的反例实现，
 * 刻意不进 `src/`：它不是备选方案，是警戒线）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sriBootstrap, computeSRI, sriLastN, sriLeaveOneOut, buildGrid,
} from '../src/sri.js';
import { mulberry32, percentile } from '../src/bootstrap.js';
import { allSleep, mainSleep } from '../src/records.js';
import * as fx from './fixtures/synthetic.mjs';

/**
 * 30 晚、带**真实抖动与漂移**的确定性合成序列（2026-03-01 起，每晚 8 小时）。
 *
 * ⚠️ 为什么不用「每晚固定差几小时」那种整齐数据：那样相邻天对的 `same` 会变成**周期 7 的
 *    完全可预测序列**，重抽样等于在测一个没有随机性的对象，区间宽度也就没有意义。
 *    这里用两条无理数频率的正弦叠加当伪随机源 —— **刻意不用 `Math.random`**（测试必须可复现），
 *    也刻意不借用 `bootstrap.js` 的 PRNG（否则"改 PRNG"会连带改掉测试数据，两件事就绑死了）。
 */
const driftNights = (n = 30) => {
  let t = 0;
  return Array.from({ length: n }, (_, i) => {
    t += Math.round(45 * Math.sin(i * 2.399963) + 30 * Math.sin(i * 0.7137));
    const bedMin = 90 + t;              // 从 01:30 起漂
    const h = Math.floor(bedMin / 60);
    const m = ((bedMin % 60) + 60) % 60;
    return { bed: fx.at(fx.d(i + 1), h, m), wake: fx.at(fx.d(i + 1), h + 8, m), tz: fx.TZ };
  });
};

const width = (r) => r.hi - r.lo;

/**
 * ⚠️ **反例实现，只存在于测试里**：按 **epoch** 重抽样。
 * 这正是 ROADMAP 记的那条红线的踩法 —— 它跑得通、给出的数字也像个区间，
 * 只是**假窄**。放进测试是为了让"别这么干"变成一个会失败的断言，而不是一句注释。
 * （简化：不套有效天门槛 —— 这份 fixture 的 30 天全都有效。）
 */
const epochBootstrapWidth = (all, resamples = 500) => {
  const grid = buildGrid(all, fx.TZ);
  const days = [...grid.keys()].sort();
  const pairs = [];
  for (let i = 0; i < days.length - 1; i += 1) {
    pairs.push([grid.get(days[i]), grid.get(days[i + 1])]);
  }
  const rng = mulberry32(20261016);
  const draws = [];
  for (let r = 0; r < resamples; r += 1) {
    let same = 0;
    let total = 0;
    for (const [a, b] of pairs) {
      for (let k = 0; k < 1440; k += 1) {
        const idx = Math.floor(rng() * 1440);   // 在**一晚之内**重抽 epoch
        if (a[idx] === b[idx]) same += 1;
        total += 1;
      }
    }
    draws.push(-100 + (200 * same) / total);
  }
  draws.sort((x, y) => x - y);
  return percentile(draws, 0.975) - percentile(draws, 0.025);
};

/* ───────────────────────── 基本口径 ───────────────────────── */

test('点估计与 computeSRI 逐位一致（区间是「同一个 SRI」的不确定性，不是另一个公式）', () => {
  const all = allSleep(driftNights());
  const r = sriBootstrap(all, null, null);
  const base = computeSRI(all);

  // 非空守卫（AGENTS.md 6）：先证明被测物真的跑起来了，再断言内容。
  assert.equal(base.pairs, 29, `fixture 应当给出 29 个天对，实际 ${base.pairs}`);
  assert.equal(r.sri, base.sri);
  assert.equal(r.days, base.days);
  assert.equal(r.pairs, base.pairs);
  assert.deepEqual(r.skipped, base.skipped);
  assert.equal(r.from, base.from);
  assert.equal(r.to, base.to);
});

test('区间把点估计框住，且不越出 SRI 的值域 [−100, 100]', () => {
  const r = sriBootstrap(allSleep(driftNights()), null, null);
  assert.ok(r.lo < r.sri && r.sri < r.hi, `点估计 ${r.sri} 应当落在 (${r.lo}, ${r.hi}) 内`);
  assert.ok(r.lo >= -100 && r.hi <= 100, `区间越界：${r.lo} ~ ${r.hi}`);
});

test('★ 单位是天对，不是 epoch —— 返回值自己把单位说清楚（ROADMAP：ship it only with that unit stated）', () => {
  const r = sriBootstrap(allSleep(driftNights()), null, null);
  assert.equal(r.unit, 'day-pair');
  assert.equal(r.pairs, 29, 'pairs 就是重抽样的样本量');
  assert.equal(r.block, 2, '默认块长 2（相邻天对共享一天）');
  assert.equal(r.resamples, 2000);
  assert.equal(r.level, 0.95);
  assert.equal(r.degenerate, false);
});

/* ─────────────── ★ 红线：单位错了会给出「假窄」区间 ─────────────── */

test('★ 反例对拍：按 epoch 重抽样会给出「假窄」区间 —— 这就是 ROADMAP 记的那条红线', () => {
  const all = allSleep(driftNights());
  const dayPair = sriBootstrap(all, null, null, { resamples: 500 });
  const dayW = width(dayPair);
  const epochW = epochBootstrapWidth(all, 500);

  assert.ok(dayW > 0, '天对口径的区间不该退化成一个点');
  // ⚠️ 这条断言就是红线的守卫：epoch 口径把「一晚内部的重复」当成上千份独立证据 ⇒ 必然明显更窄。
  //    哪天有人把 sriBootstrap 改成按 epoch 抽，这里会立刻变红。
  assert.ok(
    epochW < dayW * 0.6,
    `epoch 口径必须显著更窄：epoch ${epochW.toFixed(3)} vs 天对 ${dayW.toFixed(3)}`,
  );
});

test('★ 小 n 的区间更宽 —— 「宽就是结论」，不是缺陷（ROADMAP 原文：that width is the finding）', () => {
  const all = allSleep(driftNights());
  const main = mainSleep(driftNights());
  const full = sriBootstrap(all, null, null);
  const last14 = sriBootstrap(all, main, 14);
  const last7 = sriBootstrap(all, main, 7);

  assert.equal(last7.pairs, 7);
  assert.equal(last14.pairs, 13);
  assert.equal(full.pairs, 29);
  assert.ok(width(last7) > width(last14), `近 7 晚应当比近 14 晚更宽：${width(last7).toFixed(3)} vs ${width(last14).toFixed(3)}`);
  assert.ok(width(last14) > width(full), `近 14 晚应当比全量更宽：${width(last14).toFixed(3)} vs ${width(full).toFixed(3)}`);
});

/* ───────────────────────── 随机性与参数 ───────────────────────── */

test('可复现：同一种子逐位相同 —— 区间是「这批数据的事实」，不是每次刷新都变的数字', () => {
  const all = allSleep(driftNights());
  const a = sriBootstrap(all, null, null);
  const b = sriBootstrap(all, null, null);
  assert.deepEqual(a, b);

  const other = sriBootstrap(all, null, null, { seed: 1 });
  assert.notEqual(other.lo, a.lo, '换种子应当给出不同的区间（否则种子参数是装饰）');
  assert.equal(other.sri, a.sri, '但点估计不随种子变');
});

test('块长是「保留依赖结构」的参数，不是装饰：block 1/2/3 给出不同区间', () => {
  const all = allSleep(driftNights());
  const b1 = sriBootstrap(all, null, null, { block: 1 });
  const b2 = sriBootstrap(all, null, null, { block: 2 });
  const b3 = sriBootstrap(all, null, null, { block: 3 });
  assert.equal(b1.block, 1);
  assert.equal(b3.block, 3);
  assert.notEqual(width(b1), width(b2));
  assert.notEqual(width(b2), width(b3));
  // ⚠️ 刻意**不**断言「块越大越宽」：偏差方向取决于数据的相关结构（实测这份 fixture 上是相反的）。
});

test('置信水平是参数化的：0.9 的区间严格窄于 0.95', () => {
  const all = allSleep(driftNights());
  const r90 = sriBootstrap(all, null, null, { level: 0.9 });
  const r95 = sriBootstrap(all, null, null, { level: 0.95 });
  assert.equal(r90.level, 0.9);
  assert.ok(r90.lo > r95.lo && r90.hi < r95.hi, `0.9 (${r90.lo}, ${r90.hi}) 应当被套在 0.95 (${r95.lo}, ${r95.hi}) 里面`);
});

/* ───────────────────────── 不足与边界 ───────────────────────── */

test('★ 只有 1 个天对 ⇒ degenerate=true 且 lo=hi=点估计 —— 别把「没有证据」读成「很确定」', () => {
  const r = sriBootstrap(allSleep(fx.steadyPair()), null, null);
  assert.equal(r.pairs, 1);
  assert.equal(r.sri, 100);
  assert.equal(r.lo, 100);
  assert.equal(r.hi, 100);
  assert.equal(r.degenerate, true, '区间退化必须显式标注，否则 lo===hi 会被读成"很确定"');
});

test('没有任何相邻天对 ⇒ sri/lo/hi 全 null（与 computeSRI 同一口径：这是关于数据的陈述）', () => {
  const r = sriBootstrap(allSleep(fx.missingMiddleNight()), null, null);
  assert.equal(r.pairs, 0);
  assert.equal(r.sri, null);
  assert.equal(r.lo, null);
  assert.equal(r.hi, null);
  assert.equal(r.degenerate, true);
  assert.deepEqual(r.skipped, []);
});

test('窗口锚点与 sriLastN / sriLeaveOneOut 共用同一个（防口径第四次分叉）', () => {
  const recs = driftNights(10);
  const all = allSleep(recs);
  const main = mainSleep(recs);
  const bs = sriBootstrap(all, main, 7);
  const last7 = sriLastN(all, main, 7);
  const loo = sriLeaveOneOut(all, main, 7);
  assert.equal(bs.sri, last7.sri);
  assert.equal(bs.pairs, last7.pairs);
  assert.equal(bs.days, last7.days);
  assert.equal(bs.days, loo.days);
});

test('非数组 ⇒ null（不猜）；非法参数一律抛错，不用默认值继续算', () => {
  assert.equal(sriBootstrap(null, null, null), null);
  assert.equal(sriBootstrap(42, null, null), null);

  const recs = allSleep(fx.steadyPair());
  assert.throws(() => sriBootstrap(recs, null, null, { level: 0 }), /level/);
  assert.throws(() => sriBootstrap(recs, null, null, { level: 1 }), /level/);
  assert.throws(() => sriBootstrap(recs, null, null, { resamples: 0 }), /resamples/);
  assert.throws(() => sriBootstrap(recs, null, null, { resamples: 1.5 }), /resamples/);
  assert.throws(() => sriBootstrap(recs, null, null, { block: 0 }), /block/);
});
