/**
 * 记录规范化与筛选 —— 把「标准记录数组」切成 allSleep / mainSleep。
 *
 * 标准记录形状（项目方案 §三；**库不认品牌**，小米/Apple/Gadgetbridge 的差异属于适配器的事）：
 *
 *   {
 *     bed:   1791054060,   // epoch 秒
 *     wake:  1791084000,   // epoch 秒
 *     tz:    8,            // 可选，时区偏移（小时）；缺省用调用方给的默认值
 *     dur:   499,          // 可选，分钟；缺省由 (wake-bed)/60 四舍五入推出
 *     stages: [            // 可选；有则 SRI 更准（区分「清醒」与「睡着」）
 *       { start: 1791054060, end: 1791055320, state: 2 },   // 2=深睡 3=浅睡 4=REM 5=清醒
 *     ],
 *   }
 *
 * ⚠️ 移植语义（项目方案 §十一 第 5 条）：睡眠一律归到**醒来日**（`ds = dayOf(wake)`）。
 */
import { dayOf } from './time.js';

/**
 * 规范化：丢掉 bed/wake 非正的记录，补 `dur`，按 `bed` 升序。
 * @param {Array<object>} records 标准记录数组
 * @param {number} [tz=8] 记录未带 tz 时的默认时区
 * @returns {Array<object>} 新数组（不修改入参）
 */
export function normalize(records, tz = 8) {
  const out = [];
  for (const r of records ?? []) {
    if (r === null || typeof r !== 'object') continue;
    // ⚠️ tz 必须校验：`'xx' * 3600` = NaN ⇒ `new Date(NaN).toISOString()` 抛 RangeError。
    //    非数字一律回退到调用方给的默认值 —— 拦在这一层，下游（sri / phase / audit）就不必各防一遍。
    const tzNum = Number(r.tz);
    const t = r.tz === undefined || r.tz === null || !Number.isFinite(tzNum) ? tz : tzNum;
    const bed = Number(r.bed);
    const wake = Number(r.wake);
    if (!(bed > 0) || !(wake > 0)) continue;
    const dur = r.dur !== undefined && r.dur !== null ? Number(r.dur) : Math.round((wake - bed) / 60);
    if (!Number.isFinite(dur)) continue;
    out.push({
      ds: dayOf(wake, t),
      bed,
      wake,
      dur,
      tz: t,
      stages: Array.isArray(r.stages) && r.stages.length ? r.stages : null,
    });
  }
  return out.sort((a, b) => a.bed - b.bed);
}

/** 全部睡眠段（含小睡）—— **SRI 必须用它**：小睡也是「睡着」（§十一 第 2 条） */
export const allSleep = (records, tz = 8) => normalize(records, tz).filter((r) => r.dur > 0);

/**
 * 主睡眠 —— 单段时长 **严格大于** minMinutes 分钟（默认 180）。
 * ⚠️ 这里刻意用 `>` 而不是 `>=`：与移植前的 `mifit/metrics.mjs` 逐位一致是回归闸门的要求
 *    （恰好 180 分钟的记录算「非主睡眠」）。
 * @param {Array<object>} records
 * @param {number} [minMinutes=180]
 * @param {number} [tz=8]
 */
export const mainSleep = (records, minMinutes = 180, tz = 8) =>
  normalize(records, tz).filter((r) => r.dur > minMinutes);

/**
 * **每醒来日取最长一段**的主睡眠 —— 与 `mifit/analyze.mjs` 的报告/建议口径一致。
 *
 * ⚠️ 与 `mainSleep()` 有**两处刻意差异**，都别"统一"（一统一就与现役实现产生分钟级偏差）：
 *   ① 本函数按醒来日**只保留最长的一段**；`mainSleep()` 返回**所有**达标段
 *      （后者与 `mifit/metrics.mjs` 一致，相位 MSFsc / SJL 用它 —— 回归锚点就建立在那上面）。
 *   ② 本函数门槛是 **`>=` minMinutes**（对应 analyze.mjs 的 `if (dur < MIN_MAIN) continue`）；
 *      `mainSleep()` 是 **`>`**（对应 metrics.mjs 的 `if (!(dur > minMinutes)) continue`）。
 *
 * 实测依据（2026-10-13）：两者混用会让「今晚建议上床」差 1 分钟（现役 08:01/00:16 vs 混用后 08:02/00:17）。
 *
 * @param {Array<object>} records
 * @param {number} [minMinutes=180]
 * @param {number} [tz=8]
 * @returns {Array<object>} 每个醒来日至多一条，按 bed 升序
 */
export function dailyMain(records, minMinutes = 180, tz = 8) {
  const byDay = new Map();
  for (const r of normalize(records, tz)) {
    if (!(r.dur >= minMinutes)) continue;
    const cur = byDay.get(r.ds);
    if (cur === undefined || r.dur > cur.dur) byDay.set(r.ds, r);
  }
  return [...byDay.values()].sort((a, b) => a.bed - b.bed);
}
