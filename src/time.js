/**
 * 时间 / 圆周工具 —— 纯函数，零依赖，不读文件、不联网。
 *
 * ⚠️ 移植语义（项目方案 §十一 第 1 条）：
 *   入睡点一律用「圆周均值」，跨午夜相减用 circular「shorter」口径（R 包 mctq 作者口径）。
 *   线性平均会把 23:50 与 00:10 平均成 12:00 —— 这是最容易顺手写错的一处。
 *
 * 时区：每条记录的 `tz` 优先（小时偏移，如 +8）；函数默认 8 只为兼容本机历史数据。
 */

/**
 * `circStats()` 的返回 —— 圆周统计（均值 · 圆周标准差 · 合向量长度）。
 * ⚠️ 四个正交方向的合向量在浮点下不会**正好**为零 ⇒ `R` 太小则返回 `null`，
 * 而不是给出"看着像数的胡说值"（曾经算出 1976 分钟那种）。
 * @typedef {object} CircStats
 * @property {number} n 样本数
 * @property {number|null} mean 圆周均值（分钟 0..1439）；空输入为 `null`
 * @property {number|null} sd 圆周标准差（分钟）
 * @property {number|null} R 合向量长度（0~1，越大越集中）；发散时为 `null`
 */

/** 一天秒数 */
export const SEC_PER_DAY = 86400;

/** 一天分钟数 —— SRI 的 epoch 粒度是 1 分钟，故 M = 1440 */
export const MIN_PER_DAY = 1440;

/** 取模到 [0, m) */
export const mod = (x, m = MIN_PER_DAY) => ((x % m) + m) % m;

/** 算术均值；空数组返回 0（与移植前实现一致，调用方负责判空） */
export const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/**
 * ★ `tz` 参数的**唯一判据** —— 固定偏移小时数（**不是** IANA 时区，库不知道夏令时），必须是有限数。
 *
 * ⚠️ 不合法时**抛**，而不是回退默认值。这一点是刻意的，而且与「**数据**不合法」的处理**相反**：
 *   · 数据不合法 ⇒ 返回 `null` / `[]`（不猜；见 `records.js` 顶部那条统一规则）；
 *   · **配置**不合法 ⇒ 抛 `TypeError`。因为静默回退会**按另一个时区算**，而差一个时区就可能在
 *     「跨午夜归哪一天」上差一天 —— 报告里的日期、SRI 的天对会跟着全变，**任何断言都看不见它**。
 *     本项目最反对「悄悄给错」，所以这里选择**可见的失败**。
 *
 * `null` / `undefined` ⇒ 用 `fallback`（视同「未给」，与 `dur: null` 同一语义）。
 * 字符串数字（`'8'`）接受，会 `Number()` 化 —— 与「**记录级** tz」的回退口径保持一致。
 *
 * ⚠️ **刻意不导出到 `index.js`**：这是模块间的内部契约，不是公共 API。
 *
 * @param {unknown} tz
 * @param {string} where 调用点名字（出现在错误消息里，便于定位是谁收到的）
 * @param {number} [fallback=8]
 * @returns {number}
 * @throws {TypeError} 不是有限数
 */
export function resolveTz(tz, where, fallback = 8) {
  // 快路径：`dayOf()` 会在 `buildGrid()` 的标记循环里被每分钟调一次，别让它慢下来。
  if (typeof tz === 'number' && Number.isFinite(tz)) return tz;
  if (tz === null || tz === undefined) return fallback;
  const n = Number(tz);
  if (!Number.isFinite(n)) {
    throw new TypeError(`${where}: tz 必须是有限数（固定偏移小时，如 8；收到 ${String(tz)}）`);
  }
  return n;
}

/**
 * epoch 秒 → 该时区下的自然日 'YYYY-MM-DD'。
 * @param {number} ts epoch 秒
 * @param {number} [tz=8] 时区偏移（小时）
 * @throws {TypeError} `tz` 不是有限数（见 `resolveTz`）
 */
export const dayOf = (ts, tz = 8) =>
  new Date((ts + resolveTz(tz, 'dayOf') * 3600) * 1000).toISOString().slice(0, 10);

/**
 * 自然日 'YYYY-MM-DD' → 该日 00:00（该时区）的 epoch 秒。
 * @param {string} ds 日期串
 * @param {number} [tz=8] 时区偏移（小时）
 * @throws {TypeError} `tz` 不是有限数
 */
export const dayStartSec = (ds, tz = 8) =>
  Date.parse(ds + 'T00:00:00Z') / 1000 - resolveTz(tz, 'dayStartSec') * 3600;

/**
 * epoch 秒 → 当日「距 00:00 的分钟数」（0..1439）。
 * @param {number} ts epoch 秒
 * @param {number} [tz=8] 时区偏移（小时）
 * @throws {TypeError} `tz` 不是有限数
 */
export const clockMin = (ts, tz = 8) => {
  const d = new Date((ts + resolveTz(tz, 'clockMin') * 3600) * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/**
 * 圆周均值（分钟）。
 * @param {number[]} mins 各观测点的「当日分钟数」
 * @returns {number|null} 0..1439；空输入返回 null
 */
export const circMean = (mins) => {
  if (!mins || !mins.length) return null;
  let sx = 0;
  let sy = 0;
  for (const m of mins) {
    const a = (m / MIN_PER_DAY) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const ang = Math.atan2(sy, sx);
  return ((ang / (2 * Math.PI)) * MIN_PER_DAY + MIN_PER_DAY) % MIN_PER_DAY;
};

/**
 * 圆周差（分钟，取较短路径，带符号）—— mctq 推荐的 shorter 口径。
 * @param {number} a 分钟
 * @param {number} b 分钟
 * @returns {number} -720..720
 */
export const circDiff = (a, b) => {
  let d = (((a - b) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  if (d > 720) d -= MIN_PER_DAY;
  return d;
};

/**
 * 圆周统计三件套：集中趋势 + 离散度 + 集中度。
 *
 * `sd` 用**圆周标准差**（Berens P. *CircStat: A MATLAB Toolbox for Circular Statistics.*
 * J Stat Softw 2009;31(10)）：`sd = sqrt(−2·ln R) · (1440/2π)` 分钟，其中 `R` = 合向量长度 / n。
 *   · `R → 1`：高度集中 ⇒ `sd → 0`
 *   · `R → 0`：接近均匀分布 ⇒ `sd` 发散 ⇒ **返回 `sd: null`**（宁可说"没有意义"，也不给一个像数的胡说值）
 *
 * ⚠️ `R` 小于约 0.3 时标准差的意义已经很弱 —— 所以它和 `R` 一起返回，**别只看 `sd`**。
 *
 * @param {number[]} mins 当日分钟数数组
 * @returns {CircStats}
 */
export function circStats(mins) {
  const n = Array.isArray(mins) ? mins.length : 0;
  if (n === 0) return { n: 0, mean: null, sd: null, R: null };
  let c = 0;
  let s = 0;
  for (const m of mins) {
    const a = (m / MIN_PER_DAY) * 2 * Math.PI;
    c += Math.cos(a);
    s += Math.sin(a);
  }
  const R = Math.sqrt(c * c + s * s) / n;
  // R 用 1e-9 而不是 0 当门槛：四个正交方向的和向量在浮点下不会**正好**为零，
  // 不设阈值就会算出 1976 分钟这种"发散值"——那是个看着像数的胡说值。
  const sd = n >= 2 && R > 1e-9 ? Math.sqrt(-2 * Math.log(R)) * (MIN_PER_DAY / (2 * Math.PI)) : null;
  return { n, mean: circMean(mins), sd, R };
}
