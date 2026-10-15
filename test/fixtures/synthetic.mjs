/**
 * 合成数据 fixture —— **只用合成数据做测试**（设计笔记 §五 红线 1：真实健康数据绝不进仓库）。
 *
 * 覆盖 §10.3 要求的 7 个场景，一个都不许少：
 *   ① 跨午夜  ② 缺一整晚  ③ 只剩一小段小睡的天  ④ 调休上班的周六
 *   ⑤ 下午长睡（小睡）  ⑥ 同一日两段睡眠  ⑦ 跨时区记录混排
 *
 * 日期全落在 **2026-03**（31 天），避开 2026 年的法定假日，便于手算。
 */
import { dayStartSec } from '../../src/time.js';

export const TZ = 8;

/** 某自然日 00:00 的 epoch 秒 */
export const dayAt = (ds) => dayStartSec(ds, TZ);

/** 某自然日 hh:mm 的 epoch 秒 */
export const at = (ds, hh, mm = 0) => dayAt(ds) + hh * 3600 + mm * 60;

/** 2026-03-NN（i 从 1 起） */
export const d = (i) => `2026-03-${String(i).padStart(2, '0')}`;

/* ───────────────────────── ① 手算基准 ───────────────────────── */

/**
 * 两天**完全相同**、且睡眠不跨午夜（01:00–09:00，同一天内 480 分钟）。
 * ⇒ 两天的 24h 序列逐位相同 ⇒ SRI 必须**正好等于 100**。
 */
export const steadyPair = () => [
  { bed: at(d(1), 1), wake: at(d(1), 9), tz: TZ },
  { bed: at(d(2), 1), wake: at(d(2), 9), tz: TZ },
];

/**
 * 与上同，但第二天整体后移 1 分钟（01:01–09:01）。
 * ⇒ 只有 2 个 epoch 不同（01:00 与 09:00）⇒ 手算 SRI = -100 + 200·1438/1440 = 99.7222…
 */
export const shiftedByOneMinutePair = () => [
  { bed: at(d(1), 1), wake: at(d(1), 9), tz: TZ },
  { bed: at(d(2), 1, 1), wake: at(d(2), 9, 1), tz: TZ },
];

/* ───────────────────────── ② 跨午夜 ───────────────────────── */

/** 23:50 睡 → 次日 07:10 起。线性平均会把入睡点算成 15:30，圆周均值必须给 23:50。 */
export const crossMidnight = () => [
  { bed: at(d(1), 23, 50), wake: at(d(2), 7, 10), tz: TZ },
];

/** 连续 4 天跨午夜（23:50–07:10），用于看窗口与有效天门槛的相互作用 */
export const crossMidnightRun = (n = 4) =>
  Array.from({ length: n }, (_, i) => ({
    bed: at(d(i + 1), 23, 50),
    wake: at(d(i + 2), 7, 10),
    tz: TZ,
  }));

/* ───────────────────────── ③ 缺一整晚 ───────────────────────── */

/** 只有第 1、3 天有记录，**第 2 天整晚缺失** ⇒ 相邻天对必须整段跳过（gap=2） */
export const missingMiddleNight = () => [
  { bed: at(d(1), 1), wake: at(d(1), 9), tz: TZ },
  { bed: at(d(3), 1), wake: at(d(3), 9), tz: TZ },
];

/* ───────────────────────── ④ 只剩一小段小睡的天 ───────────────────────── */

/**
 * 第 2 天**主睡眠缺失**，只剩一段 26 分钟小睡（08:00–08:26）。
 * ⇒ 有效天门槛（≥180 分钟）必须把这一天整个剔除，否则它会整天按「醒」污染比对
 *   （这正是 §十一 第 3 条那个把近 7 晚白拉低 9.5 分的 bug）。
 */
export const napOnlyDay = () => [
  { bed: at(d(1), 1), wake: at(d(1), 9), tz: TZ },
  { bed: at(d(2), 8), wake: at(d(2), 8, 26), tz: TZ },
  { bed: at(d(3), 1), wake: at(d(3), 9), tz: TZ },
];

/** 同上，但门槛设为 0 ⇒ 复现旧口径（只用于对照历史锚点） */
export const napOnlyDayLegacy = napOnlyDay;

/* ───────────────────────── ⑤⑥ 小睡 / 同日两段 ───────────────────────── */

/**
 * 每天：主睡眠 01:00–09:00（480 分钟）+ 下午小睡 14:00–15:00（60 分钟）。
 * ⇒ SRI 必须**把小睡算进去**（睡着就是睡着）。
 * 另有 `noNap` 版本用于对照：两者算出的 SRI 必须不同。
 */
export const withAfternoonNap = (n = 3) =>
  Array.from({ length: n }, (_, i) => [
    { bed: at(d(i + 1), 1), wake: at(d(i + 1), 9), tz: TZ },
    { bed: at(d(i + 1), 14), wake: at(d(i + 1), 15), tz: TZ },
  ]).flat();

export const withoutAfternoonNap = (n = 3) =>
  Array.from({ length: n }, (_, i) => ({
    bed: at(d(i + 1), 1),
    wake: at(d(i + 1), 9),
    tz: TZ,
  }));

/* ───────────────────────── ⑦ 跨时区混排 ───────────────────────── */

/** 同一条记录流里混了 tz=0 与 tz=8 —— 库必须按**每条记录自己的 tz** 归日 */
export const mixedTz = () => [
  { bed: at(d(1), 1), wake: at(d(1), 9), tz: TZ },
  { bed: at(d(2), 17), wake: at(d(2), 23), tz: 0 }, // 该记录按 UTC 归日
  { bed: at(d(3), 1), wake: at(d(3), 9), tz: TZ },
];

/* ───────────────────────── ④ 调休上班的周六 ───────────────────────── */

/**
 * **2026-10-10 是调休上班日**（周六上班，见 data/holidays.json 的 workdays）。
 * 休息日判定必须把它判成「工作日」；而 2026-10-03（周六、且在国庆连休里）判成「休息日」。
 */
export const makeupWorkday = '2026-10-10';
export const holidaySaturday = '2026-10-03';
export const plainWorkday = '2026-10-09'; // 周五
export const plainWeekend = '2026-10-11'; // 周日
