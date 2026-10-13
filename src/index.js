/**
 * sleepmetrics —— 对外唯一边界：**只 re-export，不写逻辑**（项目方案 §10.1）。
 *
 * 三条硬边界（§10.2，越界就是设计坏了）：
 *   1. **不碰网络** —— 库永远不发请求（接口层留在各人自己的机器上）
 *   2. **不碰文件系统** —— 输入是数组、输出是对象；节假日表由参数注入（读文件只允许发生在 bin/）
 *   3. **不认品牌** —— 库不知道小米 / Apple / Gadgetbridge 的存在，那是适配器的事
 *
 * 快速上手：
 *   import { allSleep, mainSleep, computeSRI, sriLastN, computePhase, makeRestJudge } from 'sleepmetrics'
 *
 *   const all  = allSleep(records)          // 含小睡 —— 算 SRI 用它
 *   const main = mainSleep(records)         // 主睡眠 —— 取窗口锚点 / 算相位用它
 *   computeSRI(all)                         // 全量 SRI
 *   sriLastN(all, main, 7)                  // 近 7 晚 SRI（锚点唯一，见 sriLastN 注释）
 *   const rest = makeRestJudge(holidays)    // 表自己读（库不读）
 *   computePhase(main, rest.isRest)         // MSFsc / SJL
 */

export {
  SEC_PER_DAY,
  MIN_PER_DAY,
  mod,
  avg,
  dayOf,
  dayStartSec,
  clockMin,
  circMean,
  circDiff,
  circStats,
} from './time.js';

export { normalize, allSleep, mainSleep, dailyMain } from './records.js';

export { buildGrid, computeSRI, sriLastN, sriLeaveOneOut } from './sri.js';

export { computeIS, computeIV } from './rhythm.js';

export { computePhase, minToClock, chronotype, compareChronotype } from './phase.js';

export { auditRecords } from './audit.js';

export { makeRestJudge, dowOf, isWeekend } from './rest.js';

export {
  suggest,
  nudgeDecision,
  normalizeNight,
  DEFAULT_TARGET_MINUTES,
  DEFAULT_LATENCY_MINUTES,
  NIGHT_START_MINUTES,
  NIGHT_END_MINUTES,
  LATE_MINUTES,
} from './suggest.js';

/** 医学免责的唯一来源（见 `disclaimer.js`）；**建议类 / 解释类返回值都必须带它**。 */
export { DISCLAIMER } from './disclaimer.js';
