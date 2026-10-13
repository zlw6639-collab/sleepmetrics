/**
 * 建议引擎（规则层）—— **每条输出都带 `ruleId` + 触发它的数字**。
 *
 * ⚠️ 两条红线（项目方案 §五）：
 *   3. **不自创算法** —— 这里只有两类东西：① 从本机 `mifit/analyze.mjs` 提炼的既有规则；
 *      ② 有文献出处的指标。**没有**「睡眠债 = 累计缺口小时数」这类无出处口径。
 *   4. **医学免责** —— 任何输出都带 `disclaimer`，用它的人必须原样透出。
 *
 * 设计约束：
 *   · 本模块**纯函数** —— 不读文件、不落盘、不起定时器。
 *     「一晚最多提醒一次」那种状态由调用方管理（本机是 `mifit/raw/nudge.log`）。
 *   · `isRest` 由调用方注入（见 `rest.js`）—— 库不认识日历。
 *   · 入睡点一律**圆周均值**（§十一 第 1 条），别退回算术平均（23:50 与 00:10 会平均成 12:00）。
 */
import { MIN_PER_DAY, SEC_PER_DAY, avg, circMean, clockMin, dayOf, mod } from './time.js';
import { dailyMain } from './records.js';
import { DISCLAIMER } from './disclaimer.js';

/** 目标睡眠时长（分钟）—— 沿用本机历史默认 7h30 */
export const DEFAULT_TARGET_MINUTES = 450;
/** 入睡潜伏（分钟）—— 上床到睡着要预留的时间 */
export const DEFAULT_LATENCY_MINUTES = 15;
/** 催睡闸门的时间窗（分钟；跨午夜） */
export const NIGHT_START_MINUTES = 21 * 60;
export const NIGHT_END_MINUTES = 6 * 60;
/** 超过建议上床点多久才算「真晚了」 */
export const LATE_MINUTES = 30;

// 医学免责的唯一来源在 disclaimer.js（要改措辞去那里改）；这里 re-export 保持向后兼容。
export { DISCLAIMER };

const median = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/**
 * 把钟表分钟归一到「凌晨算作前一天深夜」的坐标系（< 12:00 ⇒ +24h）。
 * ⚠️ 比较跨午夜的两个时刻前**双方都要归一**，否则差值会差整整一天（本机踩过）。
 */
export const normalizeNight = (m) => {
  const x = mod(Math.round(m), MIN_PER_DAY);
  return x < 12 * 60 ? x + MIN_PER_DAY : x;
};

/**
 * 算今晚的建议上床点，并把理由逐条摊开。
 *
 * @param {Array<object>} records 标准记录数组（含小睡无妨，内部只取主睡眠）
 * @param {object} [opts]
 * @param {number} [opts.now] 当前 epoch 秒（默认取系统时间）
 * @param {(ds: string) => boolean} [opts.isRest] 休息日判定（注入）
 * @param {number} [opts.targetMinutes] 目标睡眠时长（默认 450 = 7h30）
 * @param {number} [opts.latencyMinutes] 入睡潜伏（默认 15）
 * @param {number} [opts.tz] 默认时区
 * @returns {object} `{ bedtime, wakeTarget, tomorrow, reasons[], facts[], disclaimer }`；
 *                   缺主睡眠时返回 `{ insufficient: true, reason }`
 */
export function suggest(records, {
  now = Math.floor(Date.now() / 1000),
  isRest = () => false,
  targetMinutes = DEFAULT_TARGET_MINUTES,
  latencyMinutes = DEFAULT_LATENCY_MINUTES,
  tz = 8,
} = {}) {
  const main = dailyMain(records, 180, tz);
  if (main.length === 0) {
    return { insufficient: true, reason: '没有主睡眠记录（>180 分钟），算不出建议', disclaimer: DISCLAIMER };
  }

  const todayDs = dayOf(now, tz);
  const tomorrowDs = dayOf(now + SEC_PER_DAY, tz);
  const tomorrowRest = isRest(tomorrowDs);

  const workWake = main.filter((r) => !isRest(r.ds)).map((r) => clockMin(r.wake, r.tz ?? tz));
  const restWake = main.filter((r) => isRest(r.ds)).map((r) => clockMin(r.wake, r.tz ?? tz));

  const reasons = [];
  let wakeTarget = null;

  if (tomorrowRest) {
    const m = median(restWake);
    if (m !== null) {
      wakeTarget = m;
      reasons.push({
        ruleId: 'wakeTarget.rest',
        text: '明天是休息日 ⇒ 目标起床点取「休息日醒来时间」的中位数',
        numbers: { medianMinutes: m, n: restWake.length },
      });
    } else {
      const w = median(workWake);
      if (w === null) {
        return { insufficient: true, reason: '既没有休息日也没有工作日的主睡眠记录', disclaimer: DISCLAIMER };
      }
      wakeTarget = w + 40;
      reasons.push({
        ruleId: 'wakeTarget.rest.fallback',
        text: '明天是休息日，但没有休息日记录 ⇒ 用工作日中位数 + 40 分钟兜底',
        numbers: { workMedianMinutes: w, plusMinutes: 40 },
      });
    }
  } else {
    const w = median(workWake);
    if (w === null) {
      return { insufficient: true, reason: '没有工作日的主睡眠记录（只有休息日数据）', disclaimer: DISCLAIMER };
    }
    wakeTarget = w;
    reasons.push({
      ruleId: 'wakeTarget.work',
      text: '明天是工作日 ⇒ 目标起床点取「工作日醒来时间」的中位数',
      numbers: { medianMinutes: w, n: workWake.length },
    });
  }

  const bedtime = mod(wakeTarget - targetMinutes - latencyMinutes);
  reasons.push({
    ruleId: 'bedtime.backward',
    text: '建议上床 = 目标起床 − 目标时长 − 入睡潜伏',
    numbers: { wakeTarget, targetMinutes, latencyMinutes, bedtime },
  });

  const recent = main.slice(-7);
  const facts = [];
  if (recent.length) {
    const bedTimes = recent.map((r) => clockMin(r.bed, r.tz ?? tz));
    const shortest = [...recent].sort((a, b) => a.dur - b.dur).slice(0, 2)
      .map((r) => ({ ds: r.ds, durationMinutes: r.dur }));
    facts.push({
      ruleId: 'fact.recent7',
      text: '近 7 晚的客观数字（是事实，不是建议）',
      numbers: {
        n: recent.length,
        avgDurationMinutes: Math.round(avg(recent.map((r) => r.dur))),
        bedtimeCircMeanMinutes: Math.round(circMean(bedTimes)), // ★ 圆周均值，不是算术平均
        shortestTwoNights: shortest,
      },
    });
  }

  return {
    today: todayDs,
    tomorrow: tomorrowDs,
    tomorrowIsRest: tomorrowRest,
    wakeTarget,
    bedtime,
    targetMinutes,
    latencyMinutes,
    reasons,
    facts,
    disclaimer: DISCLAIMER,
  };
}

/**
 * 催睡闸门 —— 纯判定，**不落盘**（「一晚最多一次」的记性由调用方负责）。
 *
 * 允许提醒的三个条件（全部满足）：
 *   ① 在 21:00 ~ 次日 06:00 内；② 超过建议上床点 ≥ lateMinutes；③ 今天还没说过。
 *
 * @param {object} opts
 * @param {number} opts.nowMinutes 现在几点（当日分钟，0..1439）
 * @param {number} opts.bedtimeMinutes 建议上床点（分钟）
 * @param {number} [opts.saidToday] 今天已经提醒过几次
 * @returns {{allowed: boolean, ruleId: string, reason: string, deltaMinutes: number}}
 */
export function nudgeDecision({
  nowMinutes,
  bedtimeMinutes,
  saidToday = 0,
  lateMinutes = LATE_MINUTES,
  nightStartMinutes = NIGHT_START_MINUTES,
  nightEndMinutes = NIGHT_END_MINUTES,
} = {}) {
  const nowN = normalizeNight(nowMinutes);
  const bedN = normalizeNight(bedtimeMinutes);
  const deltaMinutes = nowN - bedN;
  const inNight = nowN >= normalizeNight(nightStartMinutes) && nowN <= normalizeNight(nightEndMinutes);

  if (!inNight) {
    return {
      allowed: false,
      ruleId: 'nudge.outside-window',
      reason: `不在催睡时段（只在 ${clockOf(nightStartMinutes)} ~ ${clockOf(nightEndMinutes)} 考虑）`,
      deltaMinutes,
    };
  }
  if (deltaMinutes < lateMinutes) {
    return {
      allowed: false,
      ruleId: 'nudge.too-early',
      reason: `还没到点（或刚过点不到 ${lateMinutes} 分钟）`,
      deltaMinutes,
    };
  }
  if (saidToday > 0) {
    return {
      allowed: false,
      ruleId: 'nudge.already-said',
      reason: `今天已经提醒过 ${saidToday} 次`,
      deltaMinutes,
    };
  }
  return {
    allowed: true,
    ruleId: 'nudge.allowed',
    reason: '确实晚了，且今天还没说过',
    deltaMinutes,
  };
}

const clockOf = (m) => {
  const v = mod(Math.round(m), MIN_PER_DAY);
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};
