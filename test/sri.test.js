import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSRI, sriLastN, sriLeaveOneOut, buildGrid } from '../src/sri.js';
import { allSleep, mainSleep, normalize } from '../src/records.js';
import * as fx from './fixtures/synthetic.mjs';

test('两天完全一致 ⇒ SRI 正好 100，且只有 1 个天对', () => {
  const r = computeSRI(allSleep(fx.steadyPair()));
  assert.equal(r.days, 2);
  assert.equal(r.pairs, 1);
  assert.equal(r.sri, 100);
});

test('整体后移 1 分钟 ⇒ 手算 -100 + 200·1438/1440（只有 2 个 epoch 不同）', () => {
  const r = computeSRI(allSleep(fx.shiftedByOneMinutePair()));
  const expected = -100 + (200 * 1438) / 1440;
  assert.ok(Math.abs(r.sri - expected) < 1e-9, `实际 ${r.sri}，手算 ${expected}`);
});

test('★ SRI 的取值范围是 −100~100（不是 0~100 的"分数"）—— 上下界都能真的取到', () => {
  // 上界：两天逐位相同 ⇒ 100
  const a = computeSRI(allSleep(fx.steadyPair()));
  assert.equal(a.sri, 100);

  // 下界：两天的睡眠窗口**恰好互补**（各 12h、错开 12h）⇒ 同一钟点状态永远相反
  // ⇒ 同一态占比 0 ⇒ −100 + 0 = **−100**。
  // （⚠️ 别用「一天睡 8h、另一天全醒」来构造：那天只有 480 分钟睡眠，过了门槛，
  //   但两天的**同态占比**还有 1/3，得到的是 −33.33 —— 不是下界。）
  const b = computeSRI(allSleep([
    { bed: fx.at(fx.d(1), 0), wake: fx.at(fx.d(1), 12), tz: fx.TZ },
    { bed: fx.at(fx.d(2), 12), wake: fx.at(fx.d(2), 24), tz: fx.TZ },
  ]));
  assert.equal(b.sri, -100, `逐位相反必须给 −100，实际 ${b.sri}`);

  // 反面教材守卫：下界**不是** 0 —— 谁把范围当成 0~100，谁就会把 −100 读成"最差"而不是"反着"
  assert.ok(b.sri < 0, '负值是这条定义的自然结果，不许被夹到 0');
  assert.ok(a.sri <= 100 && b.sri >= -100, '上下界都不许越出 [−100, 100]');
});

test('中间缺一整晚 ⇒ 不成对、SRI 为 null（不许拿「全醒日」充数）', () => {
  const r = computeSRI(allSleep(fx.missingMiddleNight()));
  assert.equal(r.days, 2);
  assert.equal(r.pairs, 0);
  assert.equal(r.sri, null);
});

test('有效天门槛（§十一 第 3 条）：只剩 26 分钟小睡的那天被整个剔除', () => {
  const r = computeSRI(allSleep(fx.napOnlyDay()));
  assert.deepEqual(r.skipped, ['2026-03-02']);
  assert.equal(r.days, 2);
  // 剩下的 3-01 与 3-03 不相邻 ⇒ 仍不成对
  assert.equal(r.pairs, 0);
});

test('门槛设 0 ⇒ 复现旧口径（那天被当成有效天参与比对）—— 只用于对照历史锚点', () => {
  const legacy = computeSRI(allSleep(fx.napOnlyDayLegacy()), { minDayMinutes: 0 });
  assert.equal(legacy.skipped.length, 0);
  assert.equal(legacy.days, 3);
  assert.equal(legacy.pairs, 2); // 三天相邻 ⇒ 2 对（3-01↔3-02、3-02↔3-03）—— 旧口径正是在这里被污染
  assert.ok(legacy.sri < 100);
});

test('小睡必须算进 SRI：它确实进了当天的 24h 序列（480 + 60 = 540 分钟）', () => {
  const grid = buildGrid(allSleep(fx.withAfternoonNap(1)), fx.TZ);
  const asleep = grid.get('2026-03-01').reduce((a, b) => a + b, 0);
  assert.equal(asleep, 540);
  // 对照：不含小睡时只有 480
  const grid2 = buildGrid(allSleep(fx.withoutAfternoonNap(1)), fx.TZ);
  assert.equal(grid2.get('2026-03-01').reduce((a, b) => a + b, 0), 480);
});

test('sriLastN：锚点取「主睡眠最后一条」—— 拿 allSegs 当锚会让窗口整体前移', () => {
  const mainRecs = Array.from({ length: 8 }, (_, i) => ({
    bed: fx.at(fx.d(i + 1), 1),
    wake: fx.at(fx.d(i + 1), 9),
    tz: fx.TZ,
  }));
  const nap = { bed: fx.at(fx.d(9), 14), wake: fx.at(fx.d(9), 15), tz: fx.TZ };
  const recs = [...mainRecs, nap];
  const all = allSleep(recs);
  const main = mainSleep(recs);

  const good = sriLastN(all, main, 7); // 正确：锚点 = 3-08 09:00 ⇒ 含 3-01…3-08
  const wrong = sriLastN(all, all, 7); // 反例：锚点 = 3-09 15:00（小睡）⇒ 前移一天

  assert.equal(good.days, 8);
  assert.equal(wrong.days, 6);
  assert.equal(good.pairs, 7);
  assert.equal(wrong.pairs, 5);
});

test('sriLastN：w 为 null/0 时退化为全量', () => {
  const recs = allSleep(fx.steadyPair());
  assert.equal(sriLastN(recs, recs, null).sri, computeSRI(recs).sri);
  assert.equal(sriLastN(recs, recs, 0).sri, computeSRI(recs).sri);
});

test('跨时区混排：按每条记录自己的 tz 归日', () => {
  const recs = normalize(fx.mixedTz(), fx.TZ);
  const days = recs.map((r) => r.ds);
  assert.equal(days.length, 3);
  // 第二条带 tz=0（UTC 17:00 = 北京次日 01:00）⇒ 归到 3-03 而不是 3-02
  assert.deepEqual([...new Set(days)].sort(), ['2026-03-01', '2026-03-02', '2026-03-03']);
});

/* ─────────── ★ leave-one-day-out：回答「哪一晚在拖后腿」 ─────────── */

/**
 * 4 晚：1/2/4 是 01:00–09:00，**第 3 晚晚 2 小时**（03:00–09:00）。
 * ⇒ 对(1,2) 逐位相同 =1440；对(2,3)、对(3,4) 各差 **120** 个 epoch（01:00–03:00 那段一天睡一天醒）。
 * 基准 same = 1440 + 1320 + 1320 = 4080 / 4320 ⇒ 手算 SRI = 88.8888…。
 */
const skewedFour = () => [
  { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: fx.TZ },
  { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9), tz: fx.TZ },
  { bed: fx.at(fx.d(3), 3), wake: fx.at(fx.d(3), 9), tz: fx.TZ },
  { bed: fx.at(fx.d(4), 1), wake: fx.at(fx.d(4), 9), tz: fx.TZ },
];

test('LOO：基准值与 computeSRI 同一口径（不多算也不少算）', () => {
  const recs = allSleep(skewedFour());
  const r = sriLeaveOneOut(recs, null, null);
  assert.equal(r.sri, computeSRI(recs).sri);
  assert.equal(r.days, 4);
  assert.equal(r.pairs, 3);
  assert.ok(Math.abs(r.sri - (-100 + (200 * 4080) / 4320)) < 1e-9, `实际 ${r.sri}`);
});

test('LOO：偏离的那一晚 Δ 为正 —— 「去掉它 SRI 反而升」才叫拖后腿', () => {
  const r = sriLeaveOneOut(allSleep(skewedFour()), null, null);
  const by = Object.fromEntries(r.out.map((o) => [o.date, o]));
  // 去掉 3-03（晚 2 小时那晚）⇒ 只剩一对、两天全同 ⇒ 正好 100
  assert.ok(Math.abs(by['2026-03-03'].sri - 100) < 1e-9);
  assert.ok(by['2026-03-03'].delta > 0, '偏离的晚上 Δ 应为正');
  // 端点 3-01：剩 (2,3)(3,4) 两对，same = 1320 + 1320
  assert.ok(Math.abs(by['2026-03-01'].sri - (-100 + (200 * 2640) / 2880)) < 1e-9);
  assert.ok(by['2026-03-01'].delta < 0);
});

test('LOO：中间天少 2 对、端点天少 1 对（对数损失可预测）', () => {
  const r = sriLeaveOneOut(allSleep(skewedFour()), null, null);
  const by = Object.fromEntries(r.out.map((o) => [o.date, o]));
  assert.equal(by['2026-03-02'].pairs, 1);
  assert.equal(by['2026-03-03'].pairs, 1);
  assert.equal(by['2026-03-01'].pairs, 2);
  assert.equal(by['2026-03-04'].pairs, 2);
});

test('LOO：孤立自然日 isolated=true 且 Δ=0 —— 别把它读成「这晚很规律」', () => {
  const recs = allSleep([
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: fx.TZ },
    { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9), tz: fx.TZ },
    { bed: fx.at(fx.d(4), 1), wake: fx.at(fx.d(4), 9), tz: fx.TZ }, // 3-03 整晚缺失
  ]);
  const r = sriLeaveOneOut(recs, null, null);
  const by = Object.fromEntries(r.out.map((o) => [o.date, o]));
  assert.equal(by['2026-03-04'].isolated, true);
  assert.equal(by['2026-03-04'].delta, 0);
  assert.equal(by['2026-03-01'].isolated, false);
  assert.equal(by['2026-03-02'].isolated, false);
});

test('★ LOO：不跨午夜时，与「物理删掉那天再重跑 computeSRI」逐位一致（独立交叉验证）', () => {
  const recs = skewedFour();
  const r = sriLeaveOneOut(allSleep(recs), null, null);
  for (const o of r.out) {
    // 该 fixture 每段都不跨午夜 ⇒ 删掉某天的记录后那天必然不足门槛而被剔除，语义与 LOO 相同。
    // ⚠️ 跨午夜的记录下两者**会不同**（见 sri.js 的 JSDoc）—— 这个等价性只在「段不跨午夜」时成立。
    const without = normalize(recs).filter((x) => x.ds !== o.date);
    assert.equal(o.sri, computeSRI(allSleep(without)).sri, `${o.date} 与独立重算不一致`);
  }
});

test('LOO：窗口 w 与 sriLastN 共用同一个锚点（防口径再次分叉）', () => {
  const recs = Array.from({ length: 8 }, (_, i) => ({
    bed: fx.at(fx.d(i + 1), 1),
    wake: fx.at(fx.d(i + 1), 9),
    tz: fx.TZ,
  }));
  const all = allSleep(recs);
  const main = mainSleep(recs);
  const loo = sriLeaveOneOut(all, main, 7);
  const last7 = sriLastN(all, main, 7);
  assert.equal(loo.sri, last7.sri);
  assert.equal(loo.days, last7.days);
  assert.equal(loo.pairs, last7.pairs);
  assert.equal(loo.out.length, last7.days);
});

test('★ 数组里的 null 元素不许崩：buildGrid 跳过它、SRI 安静降级（2026-10-13 喂脏实测修的）', () => {
  const recs = [null];
  assert.doesNotThrow(() => computeSRI(recs));
  assert.doesNotThrow(() => sriLeaveOneOut(recs, null, null));
  assert.equal(computeSRI(recs).sri, null);
  assert.equal(computeSRI(recs).days, 0);
  // 同一个脏输入上，三个入口不该有两种人格：`normalize()` 一直会跳过 null，
  // `buildGrid` 原来漏了这道守卫 ⇒ `null.stages` 抛 TypeError（违反「脏数据从不报错」）。
  assert.deepEqual(allSleep(recs), []);
});
