/**
 * 类型门的**正向用例** —— 这一份必须**编译通过**（`tsc --noEmit`）。
 *
 * 它同时是 `sleepmetrics.d.ts` 的一份「用法示例」：写在这里的写法若报错，说明声明与实际
 * 可用性不符（而 README 教的就是这些写法）。
 */
import {
  allSleep,
  mainSleep,
  dailyMain,
  normalize,
  buildGrid,
  computeSRI,
  sriLastN,
  sriLeaveOneOut,
  sriBootstrap,
  computeIS,
  computeIV,
  computePhase,
  minToClock,
  chronotype,
  compareChronotype,
  auditRecords,
  makeRestJudge,
  dowOf,
  isWeekend,
  suggest,
  nudgeDecision,
  normalizeNight,
  circStats,
  circMean,
  circDiff,
  dayOf,
  dayStartSec,
  clockMin,
  mod,
  avg,
  SEC_PER_DAY,
  MIN_PER_DAY,
  DEFAULT_TARGET_MINUTES,
  DEFAULT_LATENCY_MINUTES,
  NIGHT_START_MINUTES,
  NIGHT_END_MINUTES,
  LATE_MINUTES,
  DISCLAIMER,
  type Record as SleepRecord,
  type NormalizedRecord,
  type Stage,
  type SRIResult,
  type LOOResult,
  type SRIBootstrapResult,
  type PhaseResult,
  type ISResult,
  type IVResult,
  type AuditResult,
  type RestJudge,
  type ChronotypeBucket,
  type ChronotypeComparison,
  type SuggestResult,
  type SuggestOk,
  type NudgeDecision,
  type CircStats,
} from 'sleepmetrics';

/* ── 输入形状：适配器产出原始记录 ── */
const stage: Stage = { start: 1, end: 2, state: 5 };
const records: SleepRecord[] = [
  { bed: 1_791_054_060, wake: 1_791_084_000, tz: 8, dur: 499, stages: [stage] },
  { bed: 1_791_140_000, wake: 1_791_170_000, tz: 8 },
  { bed: 0, wake: 5 }, // 脏记录：运行时会跳过，类型上仍合法（它就是那个形状）
];
// 字符串数字的 tz 与记录级一样被接受（`test/contract.test.js` 钉住）
const withStringTz: SleepRecord = { bed: 1, wake: 2, tz: '8' };

/* ── 规范化与筛选 ── */
const all: NormalizedRecord[] = allSleep(records, 8);
const main: NormalizedRecord[] = mainSleep(records, 180, 8);
const daily: NormalizedRecord[] = dailyMain(records);
const norm: NormalizedRecord[] = normalize(records, null); // 显式 null ⇒ 默认时区
const first: NormalizedRecord | undefined = all[0];

/* ── SRI ── */
const grid = buildGrid(all, 8);
if (grid) {
  const day: Uint8Array | undefined = grid.get('2026-03-01');
  if (day) day[0];
}
const sri: SRIResult | null = computeSRI(all, { minDayMinutes: 180, tz: 8 });
if (sri) {
  const value: number | null = sri.sri;
  const from: string | null = sri.from;
  const skipped: string[] = sri.skipped;
}
const windowed: SRIResult | null = sriLastN(all, main, 7, null);
const allTime: SRIResult | null = sriLastN(all, main, null);
const loo: LOOResult | null = sriLeaveOneOut(all, main, 7);
if (loo) {
  const base: number | null = loo.sri;
  for (const entry of loo.out) {
    const { date, sri: perDay, delta, pairs, isolated } = entry;
    if (delta !== null && delta > 0 && !isolated) perDay;
  }
}

/* ── SRI 的 bootstrap 区间（单位是天对，见 `unit`）── */
const ci: SRIBootstrapResult | null = sriBootstrap(all, main, 7);
if (ci) {
  const point: number | null = ci.sri;
  const lower: number | null = ci.lo;
  const upper: number | null = ci.hi;
  const asDayPair: 'day-pair' = ci.unit; // 字面量类型：换成别的口径会在编译期就红
  const { level, resamples, block, seed, degenerate, pairs: ciPairs } = ci;
}
const ciTuned: SRIBootstrapResult | null = sriBootstrap(all, null, null, {
  minDayMinutes: 180, tz: 8, level: 0.9, resamples: 500, seed: 1, block: 3,
});

/* ── IS / IV ── */
const is: ISResult | null = computeIS([1, 2, 3, 4], { perDay: 2 });
const iv: IVResult | null = computeIV([1, 2, 3]);
if (is) {
  const { is: stability, n, perDay, days } = is;
}

/* ── 相位（判别联合）── */
const judge: RestJudge = makeRestJudge({
  2026: { holidays: ['2026-10-01'], workdays: ['2026-10-11'], source: 'test' },
});
const phase: PhaseResult | null = computePhase(main, judge.isRest, { windowDays: 30, tz: 8 });
if (phase) {
  if (phase.insufficient) {
    const { nW, nF, windowDays } = phase;
  } else {
    const clock = minToClock(phase.msfsc); // string | null
    const sjl: number = phase.sjl;
    const range: string = `${phase.from} → ${phase.to}`;
  }
}
const bucket: ChronotypeBucket | null = chronotype(200, { cuts: [180, 240], labels: ['早', '中', '晚'] });
if (bucket) {
  const index: number = bucket.index;
  const label: string = bucket.label;
}
const cmp: ChronotypeComparison | null = compareChronotype({ activityIndex: 1, questionnaireIndex: 0, tolerance: 1 });
if (cmp) {
  const note: string = cmp.note;
  const d: string = cmp.disclaimer;
}

/* ── 体检：吃脏数据是它的职责 ── */
const audit: AuditResult = auditRecords([null, 'x', 42, { bed: 0, wake: 5 }]);
for (const issue of audit.issues) {
  const { ruleId, severity, message, index, stage: stageIndex } = issue;
}
const ok: boolean = audit.summary.ok;
const counts: { error: number; warn: number; info: number } = audit.summary.bySeverity;

/* ── 建议（判别联合）── */
const suggestion: SuggestResult = suggest(records, { isRest: judge.isRest, tz: 8, targetMinutes: 450 });
if (suggestion.insufficient) {
  const why: string = suggestion.reason;
  const d: string = suggestion.disclaimer;
} else {
  const okSuggestion: SuggestOk = suggestion;
  const bed: number = suggestion.bedtime;
  const tomorrow: string = suggestion.tomorrow;
  for (const reason of suggestion.reasons) {
    if (reason.ruleId === 'bedtime.backward') {
      const { wakeTarget, targetMinutes, latencyMinutes, bedtime } = reason.numbers;
    }
    if (reason.ruleId === 'wakeTarget.work' || reason.ruleId === 'wakeTarget.rest') {
      const { medianMinutes, n } = reason.numbers;
    }
  }
  for (const fact of suggestion.facts) {
    const { avgDurationMinutes, bedtimeCircMeanMinutes, shortestTwoNights } = fact.numbers;
    for (const night of shortestTwoNights) night.ds;
  }
}
const nudge: NudgeDecision = nudgeDecision({ nowMinutes: 5, bedtimeMinutes: 23 * 60 + 15, saidToday: 0 });
if (nudge.allowed) {
  const id: 'nudge.allowed' = nudge.ruleId;
  const delta: number = nudge.deltaMinutes;
} else {
  const id: 'nudge.outside-window' | 'nudge.too-early' | 'nudge.already-said' = nudge.ruleId;
}
const nudgeWithOverrides = nudgeDecision({
  nowMinutes: 0,
  bedtimeMinutes: 0,
  lateMinutes: LATE_MINUTES,
  nightStartMinutes: NIGHT_START_MINUTES,
  nightEndMinutes: NIGHT_END_MINUTES,
});

/* ── 低层工具与常量 ── */
const stats: CircStats = circStats([1430, 10]);
const mean = circMean([23 * 60 + 50, 10]); // number | null
const diff = circDiff(10, 1430);
const ds: string = dayOf(1_791_054_060, 8);
const startSec: number = dayStartSec('2026-03-01', 8);
const minute: number = clockMin(1_791_054_060, 8);
const weekday: number = dowOf('2026-03-01');
const weekend: boolean = isWeekend('2026-03-01');
const night: number = normalizeNight(60);
const m: number = mod(-1, MIN_PER_DAY);
const a: number = avg([1, 2, 3]);
const days: 86400 = SEC_PER_DAY;
const perDay: 1440 = MIN_PER_DAY;
const targets: [450, 15, 1260, 360, 30] = [
  DEFAULT_TARGET_MINUTES,
  DEFAULT_LATENCY_MINUTES,
  NIGHT_START_MINUTES,
  NIGHT_END_MINUTES,
  LATE_MINUTES,
];
const notice: string = DISCLAIMER;
