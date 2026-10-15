/**
 * IS / IV —— 昼夜节律的两个非参数指标（日间稳定性 / 日内变异性）
 *
 * 出处：van Someren EJW, Swaab DF, Colenda CC, Cohen W, McCall WV, Rosenquist PB.
 *   *Bright light therapy: improved sensitivity to its effects on rest-activity rhythms in
 *   Alzheimer patients by application of nonparametric methods.*
 *   Chronobiol Int. 1999;16(4):505-518.        ← IS / IV 的提出处
 *
 *   IS = [ N · Σ_h (x̄_h − x̄)² ] / [ p · Σ_i (x_i − x̄)² ]                 日间稳定性（0~1，越大越稳）
 *   IV = [ N · Σ_{i≥2} (x_i − x_{i−1})² ] / [ (N−1) · Σ_i (x_i − x̄)² ]   日内变异性（越小越平稳）
 *
 *   N  = 观测点数；p = 每天的点数（1440 = 每分钟一个点）
 *   x̄_h = 「每天同一时刻 h」的平均值；x̄ = 全体均值
 *
 * ⚠️ **IS 的分子分母都减全体均值**（2026-10-15 修）。原来只算二阶矩 `Σ x̄_h² / Σ x_i²`，
 *    漏了中心化。四条独立证据：
 *      ① 参考实现 `cran/nparACT` 的 `nparACT_IS()` 减了均值 —— 而它那份 IV 也减，本库 IV 与它
 *         **逐位一致**（实测四组序列）⇒ 是抄漏，不是"有意的另一种口径"；
 *      ② 内部不自洽：同一族公式里 IV 减了、IS 没减；
 *      ③ 数学：不减时 `IS = (c + K)/(d + K)`（`K = N·p·x̄²`）⇒ **系统性趋近 1**；
 *      ④ 实测 `[1000,1005,1000,995, 1000,995,1000,1005]`（两天模式**完全相反**）：
 *         原实现 **0.99999**（"完美规律"），中心化后 **0**（正确）。
 *    ⇒ 这是**会动数字**的修复：按 `RELEASE.md` §2，动数字的改动是 **minor**，不是 patch。
 *    由 `test/rhythm.test.js` 钉住（含一份逐行译自 nparACT 的参考实现作对照）。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ **口径警告 —— 必须随结果一起读**
 *
 * IS / IV 的原始定义建立在 **活动计数（activity counts）** 上。本函数接受**任意数值序列**，
 * 所以两条路都通，但**结果不可互相比较**：
 *
 *   · 传**真的 counts**（actigraphy 的分钟级活动量）⇒ 得到可与文献对照的 IS / IV；
 *   · 传**睡/醒二值序列**（0/1）⇒ 得到的是**退化形式**。它仍能回答"你的作息稳不稳"，
 *     但**数值不可**与用 counts 的研究对照 —— 量纲与分布都不同。
 *
 * ⇒ 与论文比之前，先确认对方喂的是什么。本函数**不做**任何换算或归一化来"让它看起来像"：
 *   把 0/1 序列硬掰成 counts 的分布，只会制造一个骗人的数字。
 *
 * ⚠️ 前置条件（不满足时**返回 null，不猜**）：
 *   · 输入必须**等间隔**（如每分钟一个值）；
 *   · `computeIS` 还要求长度是 **perDay 的整数倍**（整天数），且至少两天。
 * ─────────────────────────────────────────────────────────────────────────────
 */

const isSeries = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => Number.isFinite(x));

/**
 * `computeIS()` 的返回。
 * @typedef {object} ISResult
 * @property {number} is 日间稳定性（0~1，**越大越稳**）
 * @property {number} n 观测点数
 * @property {number} perDay 每天的点数
 * @property {number} days 天数
 */

/**
 * `computeIV()` 的返回。
 * @typedef {object} IVResult
 * @property {number} iv 日内变异性（**越小越平稳**）
 * @property {number} n 观测点数
 */

/**
 * 日间稳定性 IS。
 * @param {number[]} values 等间隔序列（**等间隔是你保证的**，函数无法验证）
 * @param {{perDay?: number}} [opts] `perDay` = 每天的点数（默认 1440 = 1 分钟粒度）
 * @returns {ISResult|null} 不足（非等间隔整数天 / 全零序列）时返回 `null`
 */
export function computeIS(values, opts = {}) {
  // 显式 `null` 视同「未给」⇒ 默认 `perDay`（`= {}` 默认参数只覆盖 `undefined`，不覆盖 `null`）。
  const { perDay = 1440 } = opts ?? {};
  if (!isSeries(values)) return null;
  if (!Number.isInteger(perDay) || perDay < 2) return null;
  const n = values.length;
  if (n % perDay !== 0) return null; // 不是整天 ⇒ 同一时刻对不齐，宁可不给
  const days = n / perDay;
  if (days < 2) return null; // 一天没有"日间"可言

  // ★ 分子分母都减全体均值（见文件顶部那条「IS 口径」说明）。
  let meanAll = 0;
  for (const v of values) meanAll += v;
  meanAll /= n;

  let sumSq = 0;
  for (const v of values) {
    const d = v - meanAll;
    sumSq += d * d;
  }
  if (sumSq === 0) return null; // 常数序列：总方差为 0 ⇒ 比值无定义（不是 0，是"没意义"）

  let sumMeanSq = 0;
  for (let h = 0; h < perDay; h += 1) {
    let s = 0;
    for (let d = 0; d < days; d += 1) s += values[d * perDay + h];
    const m = s / days - meanAll;
    sumMeanSq += m * m;
  }

  const is = (n * sumMeanSq) / (perDay * sumSq);
  // ⚠️ 输入元素**都有限**，不代表中间运算不溢出：`1e308` 一平方就是 `Infinity`，
  //   于是 `Infinity / Infinity = NaN`。返回 `null` 而不是 `NaN` ——
  //   "算不出来"必须**说出来**，不能给一个看着像数的东西（本库的招牌问题）。
  if (!Number.isFinite(is)) return null;
  return { is, n, perDay, days };
}

/**
 * 日内变异性 IV。
 * ⚠️ 它只看**相邻两点之差**，因此对采样间隔敏感：间隔不同，同一段记录的 IV 不可比。
 * @param {number[]} values 等间隔序列
 * @returns {IVResult|null}
 */
export function computeIV(values) {
  if (!isSeries(values) || values.length < 3) return null;
  const n = values.length;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;

  let numerator = 0;
  for (let i = 1; i < n; i += 1) {
    const d = values[i] - values[i - 1];
    numerator += d * d;
  }
  let denominator = 0;
  for (const v of values) {
    const d = v - mean;
    denominator += d * d;
  }
  if (denominator === 0) return null; // 常数序列：无变异，比值无定义（不是 0，是"没意义"）

  const iv = (n * numerator) / ((n - 1) * denominator);
  if (!Number.isFinite(iv)) return null;   // 同 `computeIS`：中间运算溢出 ⇒ 返回 null，不返回 NaN
  return { iv, n };
}
