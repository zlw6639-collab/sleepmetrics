/**
 * 医学免责 —— **全库唯一来源**（要改措辞只改这里）。
 *
 * 完整版见仓库根目录的 `DISCLAIMER.md`（那里有五节：不是医疗器械 / 数据比你想的脏 /
 * 常模不属于你 / 无担保 / 数据留在你手里 + "在它上面做产品的义务随产品走"）。
 *
 * ⚠️ 硬规矩（设计笔记 §五 红线 4）：**任何"建议类"或"解释类"输出都必须带上 `DISCLAIMER`**。
 *    目前带它的返回值：`suggest()`、`nudgeDecision()`、`compareChronotype()`。
 *    指标类纯数字（`computeSRI()` 等）不带 —— 那是计算的返回值，不是对你的评价。
 */
export const DISCLAIMER =
  'Not medical advice. These are population-level research metrics computed from your own records — '
  + 'not a diagnosis, and not a substitute for a clinician. See DISCLAIMER.md for the full version.';
