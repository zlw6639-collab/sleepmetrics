/**
 * 类型门的**反向用例** —— 每一处都必须是**真报错**的，用 `@ts-expect-error` 钉住。
 *
 * ⚠️ 这是本项目的招牌规矩（`AGENTS.md` 第 6 条）在类型层的落地：
 *    **"通过"的信号本身也可能是假的。** 一个只会说"编译过了"的类型门，在声明退化成 `any`
 *    之后**照样是绿的** —— `@ts-expect-error` 反过来要求"这里必须报错"：
 *    声明一旦变宽，这些行就不再报错 ⇒ tsc 报 *Unused '@ts-expect-error' directive* ⇒ **门变红**。
 *
 * ⇒ 改了 `sleepmetrics.d.ts` 之后，这一份必须仍然是"处处报错"的。
 */
import {
  buildGrid,
  computePhase,
  mainSleep,
  suggest,
  normalizeNight,
  nudgeDecision,
  computeSRI,
  sriBootstrap,
  type Record as SleepRecord,
  type PhaseOk,
  type SuggestOk,
} from 'sleepmetrics';

const records: SleepRecord[] = [{ bed: 1, wake: 2 }];

/* ── 1. 记录形状是被检查的 ── */
// @ts-expect-error 缺 `wake`（必需字段）
const missingWake: SleepRecord = { bed: 1 };
// @ts-expect-error 字段名拼错：本库叫 `wake`，不叫 `wak`
const typo: SleepRecord = { bed: 1, wak: 2 };
// @ts-expect-error `stages` 的元素必须是 Stage（`state` 缺了）
const badStage: SleepRecord = { bed: 1, wake: 2, stages: [{ start: 1, end: 2 }] };

/* ── 2. 可空返回必须被判空（`buildGrid` 非数组时返回 null —— JSDoc 漏了这条）── */
const grid = buildGrid(records, 8);
// @ts-expect-error 可能是 null
grid.size;

/* ── 3. `computeSRI` 可能返回 null；`sri` 本身也可能是 null ── */
const sri = computeSRI(records);
// @ts-expect-error 可能是 null
sri.days;
if (sri) {
  // @ts-expect-error `sri.sri` 是 `number | null`，不能直接当 number 用
  const n: number = sri.sri;
}

/* ── 4. 判别联合：`insufficient` 分支里真的没有那些字段 ── */
const phase = computePhase(records, () => false);
if (phase && phase.insufficient) {
  // @ts-expect-error 这一支里没有 `soW`
  phase.soW;
  // @ts-expect-error 也没有 `msfsc`
  phase.msfsc;
}

const suggestion = suggest(records);
if (suggestion.insufficient) {
  // @ts-expect-error 这一支里没有 `bedtime`
  suggestion.bedtime;
} else {
  const ok: SuggestOk = suggestion;
  // @ts-expect-error 正常分支里没有 `reason`（那是 `insufficient` 分支的字段）
  suggestion.reason;
}

/* ── 5. 门槛只收数字：`null` 会被实现当成「门槛 0」，静默改变语义 ⇒ 类型直接拦 ── */
// @ts-expect-error `minMinutes` 是 number（不是 `number | null`）
mainSleep(records, null);

/* ── 6. `nudgeDecision` **不带** `disclaimer`（实现如此；README 的描述与实现不符）── */
const nudge = nudgeDecision({ nowMinutes: 5, bedtimeMinutes: 23 * 60 });
// @ts-expect-error 这个字段在四个分支里都不存在
nudge.disclaimer;

/* ── 7. 选项对象里的字段也是被检查的 ── */
// @ts-expect-error `nudgeDecision` 没有 `nowHours` 这个选项
nudgeDecision({ nowMinutes: 0, bedtimeMinutes: 0, nowHours: 1 });
// @ts-expect-error `normalizeNight` 收分钟数，不收字符串
normalizeNight('23:50');

/* ── 8. 判别联合的一半不能被误当另一半 ── */
declare const okPhase: PhaseOk;
// @ts-expect-error `PhaseOk` 上 `insufficient` 不是 `true`
const flag: true = okPhase.insufficient;

/* ── 9. `sriBootstrap`：区间两端可空，单位是字面量类型 ── */
const ci = sriBootstrap(records, null, 7);
if (ci) {
  // @ts-expect-error `lo` 是 `number | null`（没有任何天对时为 null）—— 必须显式判空
  const lower: number = ci.lo;
  // @ts-expect-error `unit` 只可能是 `'day-pair'`：若哪天改成按 epoch 抽，这里会在编译期就红
  const epochUnit: 'epoch' = ci.unit;
}
// @ts-expect-error 第一个参数（记录数组）是必填的 —— 不是所有参数都有默认值
sriBootstrap();

void [missingWake, typo, badStage, grid, sri, phase, suggestion, nudge, flag, ci];
