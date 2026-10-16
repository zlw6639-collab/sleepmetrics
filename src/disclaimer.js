/**
 * 医学免责 —— **全库唯一来源**（要改措辞只改这里）。
 *
 * 完整版见仓库根目录的 `DISCLAIMER.md`（那里有五节：不是医疗器械 / 数据比你想的脏 /
 * 常模不属于你 / 无担保 / 数据留在你手里 + "在它上面做产品的义务随产品走"）。
 *
 * ⚠️ 硬规矩（设计笔记 §五 红线 4）：**任何"建议类"或"解释类"输出都必须带上 `DISCLAIMER`**。
 *    目前带它的返回值：`suggest()`（含 `insufficient` 分支）、`compareChronotype()`。
 *    ⚠️ **`nudgeDecision()` 不带**：它返回的是「今晚这条提醒该不该发」的**闸门判定**
 *       （`allowed` + `ruleId` + 那条规则的人话），不是对睡眠者的评价，也不是一条要原样透出的建议。
 *    ⚠️ **2026-10-16 修**：此前这里与 README 都写着它带 `DISCLAIMER`，而实现的四个分支里都没有 ——
 *       典型的散文与实现漂移（改了实现没人改描述，任何断言都看不见）。发现于逐字段写 `.d.ts`。
 *    指标类纯数字（`computeSRI()` 等）不带 —— 那是计算的返回值，不是对你的评价。
 */
export const DISCLAIMER =
  'Not medical advice. These are population-level research metrics computed from your own records — '
  + 'not a diagnosis, and not a substitute for a clinician. See DISCLAIMER.md for the full version.';
