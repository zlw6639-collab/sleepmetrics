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

/**
 * 一段睡眠分期（`stages` 数组的元素）。
 * @typedef {object} Stage
 * @property {number} start 该段开始的 epoch **秒**（UTC）
 * @property {number} end   该段结束的 epoch **秒**（UTC）
 * @property {number} state `2`=深睡 · `3`=浅睡 · `4`=REM · `5`=清醒（与主流 actigraphy 编码一致）
 */

/**
 * ★ **标准记录形状** —— 本库的**唯一输入契约**（`NON-GOALS.md` §5：库不认任何厂商格式）。
 *
 * ⚠️ 全部是**数字与数组**：没有字符串日期、没有 IANA 时区名。把小米 / Apple / Gadgetbridge 的
 * 导出变成这个东西，是**适配器**的活（`examples/mifit-to-lib.mjs` 是一个示例）。
 *
 * @typedef {object} Record
 * @property {number} bed 入睡时刻，epoch **秒**（UTC）
 * @property {number} wake 醒来时刻，epoch **秒**（UTC）
 * @property {number} [tz] **固定偏移小时数**（不是 IANA 时区；缺省用调用方给的默认值）。
 *   ⚠️ 库不知道夏令时 —— 有 DST 的地区请**逐条**给出当时生效的偏移（README §Semantics 第 7 条）。
 * @property {number} [dur] 时长（分钟）；缺省由 `(wake - bed) / 60` 四舍五入推出
 * @property {Stage[]} [stages] 睡眠分期；**有则 SRI 更准**（能区分「清醒」与「睡着」）
 */

/**
 * `normalize()` 的输出：`Record` 加上**已算好的 `ds`** 与补全后的 `dur`。
 * 库内部各模块都吃这个形状（而不是再各自算一遍日归属）。
 *
 * @typedef {object} NormalizedRecord
 * @property {string} ds 醒来日 `YYYY-MM-DD`（= `dayOf(wake, tz)`）—— 全项目的「日归属」口径
 * @property {number} bed
 * @property {number} wake
 * @property {number} dur
 * @property {number} tz
 * @property {Stage[]|null} stages **无效元素已被过滤掉**；没有有效分段时为 `null`
 */
import { dayOf } from './time.js';

/**
 * 规范化：丢掉 bed/wake 非正的记录，补 `dur`，按 `bed` 升序。
 * @param {Record[]} records 标准记录数组
 * @param {number} [tz=8] 记录未带 tz 时的默认时区
 * @returns {NormalizedRecord[]} 新数组（不修改入参）
 */
export function normalize(records, tz = 8) {
  // ⚠️ **非数组输入统一返回 `[]`**（不抛、不猜）。外部评审实测（2026-10-14）原来三种行为不一致：
  //    `normalize(42)` 抛 TypeError、`normalize('abc')` 返回 []、`normalize(null)` 返回 []。
  //    规则统一为：**返回数组的函数（normalize / allSleep / mainSleep / dailyMain）拿到非数组 ⇒ `[]`；
  //    返回对象或数值的函数（computeSRI / sriLastN / computePhase / computeIS / computeIV…）⇒ `null`。**
  //    `auditRecords()` 是例外 —— 它返回**诊断报告**，所以照旧给出 `input.not-array` 那条 error。
  if (!Array.isArray(records)) return [];
  const out = [];
  for (const r of records) {
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
    // ⚠️ stages 必须**逐项**体检：`stages: [null]` 这种（外部评审实测 2026-10-14）会让下游直接崩，
    //    而它看起来只是「一条有点怪的数据」。这里**丢掉无效元素**（不崩），
    //    由 `auditRecords()` 负责把「有多少 stage 不可用」说出来 —— 脏数据要**可见**，但不必**致命**。
    const rawStages = Array.isArray(r.stages) ? r.stages : [];
    const stages = rawStages.filter((s) => s !== null && typeof s === 'object'
      && Number.isFinite(Number(s.start)) && Number.isFinite(Number(s.end)) && Number.isFinite(Number(s.state)));
    out.push({
      ds: dayOf(wake, t),
      bed,
      wake,
      dur,
      tz: t,
      stages: stages.length ? stages : null,
    });
  }
  return out.sort((a, b) => a.bed - b.bed);
}

/** 全部睡眠段（含小睡）—— **SRI 必须用它**：小睡也是「睡着」（§十一 第 2 条）
 * @param {Record[]} records @param {number} [tz=8] @returns {NormalizedRecord[]} */
export const allSleep = (records, tz = 8) => normalize(records, tz).filter((r) => r.dur > 0);

/**
 * 主睡眠 —— 单段时长 **严格大于** minMinutes 分钟（默认 180）。
 * ⚠️ 这里刻意用 `>` 而不是 `>=`：与移植前的 `mifit/metrics.mjs` 逐位一致是回归闸门的要求
 *    （恰好 180 分钟的记录算「非主睡眠」）。
 *
 * ⚠️⚠️ **它不按天去重，也不过问这段落在夜里还是白天** —— 返回的是「**所有**达标段」。
 *    同一天若有「夜里一段 + 白天补觉一段」，**两段都会出现在结果里**。
 *    ⇒ 拿它做「逐晚入睡时刻 / 睡眠时长」这类**单晚趋势**分析，会把白天补觉当成主睡眠。
 *       **要做单晚分析请用 `dailyMain()`**（每醒来日只留最长一段）。
 *    实测（2026-10-14，本机真实数据）：214 个醒来日上 `mainSleep()` 给 217 段、
 *    `dailyMain()` 给 212 段；差出来的含 **3 个白天段**（入睡 08:08 / 08:45 / 09:05）。
 *    那 3 段**不是缺数据** —— 原始记录带 `avg_hr` 60~74、`items` 14~27 段睡眠分期、
 *    效率 93~98，是**手环实测到的白天补觉**。
 *    ⇒ 本函数保持「全部达标段」的语义是**移植要求**（相位 MSFsc / SJL 的口径与现役
 *      `mifit/metrics.mjs` 逐位一致，回归锚点就建立在那上面），**不是 bug，别"修"它**。
 *
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
 * @param {Record[]} records
 * @param {number} [minMinutes=180]
 * @param {number} [tz=8]
 * @returns {NormalizedRecord[]} 每个醒来日至多一条，按 bed 升序
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
