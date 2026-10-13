/**
 * 时间 / 圆周工具 —— 纯函数，零依赖，不读文件、不联网。
 *
 * ⚠️ 移植语义（项目方案 §十一 第 1 条）：
 *   入睡点一律用「圆周均值」，跨午夜相减用 circular「shorter」口径（R 包 mctq 作者口径）。
 *   线性平均会把 23:50 与 00:10 平均成 12:00 —— 这是最容易顺手写错的一处。
 *
 * 时区：每条记录的 `tz` 优先（小时偏移，如 +8）；函数默认 8 只为兼容本机历史数据。
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
 * epoch 秒 → 该时区下的自然日 'YYYY-MM-DD'。
 * @param {number} ts epoch 秒
 * @param {number} [tz=8] 时区偏移（小时）
 */
export const dayOf = (ts, tz = 8) =>
  new Date((ts + tz * 3600) * 1000).toISOString().slice(0, 10);

/**
 * 自然日 'YYYY-MM-DD' → 该日 00:00（该时区）的 epoch 秒。
 * @param {string} ds 日期串
 * @param {number} [tz=8] 时区偏移（小时）
 */
export const dayStartSec = (ds, tz = 8) =>
  Date.parse(ds + 'T00:00:00Z') / 1000 - tz * 3600;

/**
 * epoch 秒 → 当日「距 00:00 的分钟数」（0..1439）。
 * @param {number} ts epoch 秒
 * @param {number} [tz=8] 时区偏移（小时）
 */
export const clockMin = (ts, tz = 8) => {
  const d = new Date((ts + tz * 3600) * 1000);
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
 * @returns {{n: number, mean: number|null, sd: number|null, R: number|null}}
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
