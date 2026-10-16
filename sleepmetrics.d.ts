/**
 * `sleepmetrics` —— **手写的**类型声明（`ROADMAP.md` Next 第 1 条）。
 *
 * ⚠️ 三条设计约束，动手改之前先读：
 *   1. **手写、无构建链** —— 本项目不会长出 TypeScript 编译步骤（`RELEASE.md` §6）。
 *      这个文件是**源码**，和 `src/*.js` 一样直接发布；没有任何东西从 JSDoc 生成它。
 *   2. **镜像 JSDoc 里的 typedef**（`Record` / `Stage` / `SRIResult` / `PhaseResult` …），
 *      字段一个一个从 `src/` 与 `test/` 里读出来，**不猜**。声明写错的代价比没有声明更大。
 *   3. **参数的严格度是单向的**：
 *      · 类型**比实现更严** ⇒ 安全（顶多让调用方多写一个判空）；
 *      · 类型**比实现更宽** ⇒ **危险**（运行时会崩，而类型说没事）。
 *      所以凡是实现明确支持、且被 `test/` 钉住的输入（可空槽、`null` 选项对象、
 *      字符串数字的 `tz`…）都在这里如实放开；其余的按 JSDoc 契约收紧。
 *
 * ⚠️ **`Record` 会遮蔽 TypeScript 内置的 `Record<K, V>`** —— 这名字来自本库的 typedef，
 *    刻意不改。如果你在同一个文件里两个都要，进来时改个名：
 *    ```ts
 *    import type { Record as SleepRecord, computeSRI } from 'sleepmetrics';
 *    ```
 *
 * ⚠️ **凡与 JSDoc 不一致处，本文件一律按实现写**，并用 `⚠️ 实现与 JSDoc 不符` 就地标注。
 *    声明必须描述**真实行为**，否则它只是另一种"看着像数的胡说值"。
 */

/* ────────────────────────── 标准记录形状（`src/records.js`） ────────────────────────── */

/**
 * 一段睡眠分期（`Record.stages` 的元素）。
 *
 * ⚠️ `state` 是**厂商私有编码**：`2`=深睡 · `3`=浅睡 · `4`=REM · `5`=清醒 是小米的编号，
 *    不是 AASM/PSG。任何落在 1–5 内的错位编码**任何类型系统都拦不住** —— 喂进来之前先核对
 *    （SRI 只看睡着/清醒，所以深睡浅睡换位不要紧，**清醒码错位会直接虚高**）。
 */
export interface Stage {
  /** 该段开始的 epoch **秒**（UTC） */
  start: number;
  /** 该段结束的 epoch **秒**（UTC） */
  end: number;
  /** `2`=深睡 · `3`=浅睡 · `4`=REM · `5`=清醒 */
  state: number;
}

/**
 * ★ **标准记录形状** —— 本库的唯一输入契约（库不认任何厂商格式）。
 * 全部是数字与数组：没有字符串日期、没有 IANA 时区名（那是适配器的活）。
 */
export interface Record {
  /** 入睡时刻，epoch **秒**（UTC）—— ⚠️ 不是毫秒 */
  bed: number;
  /** 醒来时刻，epoch **秒**（UTC） */
  wake: number;
  /**
   * **固定偏移小时数**（不是 IANA 时区；库不知道夏令时）。
   * 字符串数字（`'8'`）与记录级一样被接受，与 `getTimezoneOffset()` 那类**反号**口径无关。
   */
  tz?: TzOffset | null;
  /** 时长（分钟）；缺省 / 非正 / 非数字 ⇒ 由 `(wake - bed) / 60` 四舍五入推出 */
  dur?: number | null;
  /** 睡眠分期；有则 SRI 更准（能区分「清醒」与「睡着」） */
  stages?: readonly Stage[] | null;
}

/**
 * `normalize()` 的输出：`Record` 加上**已算好的 `ds`** 与补全后的 `dur`。
 * 库内部各模块都吃这个形状（而不是再各自算一遍日归属）。
 */
export interface NormalizedRecord {
  /** 醒来日 `YYYY-MM-DD`（= `dayOf(wake, tz)`）—— 全项目的「日归属」口径 */
  ds: string;
  bed: number;
  wake: number;
  dur: number;
  tz: number;
  /** **无效元素已被过滤掉**；没有有效分段时为 `null` */
  stages: Stage[] | null;
}

/**
 * 时区偏移：小时数，或能被 `Number()` 化成小时数的字符串数字。
 * 合理范围 `[−12, +14]`；超出即 `TypeError`（`tz: 480` 这种「分钟当小时」会被拒，见 `src/time.js`）。
 */
export type TzOffset = number | string;

/**
 * 记录类函数的入参（**非导出**：只用来写签名，不是公共名字）。
 *
 * ⚠️ 为什么这么宽：README 承诺「数组里的脏槽（`null`、缺字段）不抛、只是被跳过」，
 *    而 `normalize(null)` / `auditRecords(null)` 是 `test/contract.test.js` **钉住**的行为。
 *    但元素仍是 `Record` 联合 —— 拼错字段名照样报错，只是不再因一个 `null` 槽就全线飘红。
 */
type RecordsInput = readonly (Record | NormalizedRecord | null | undefined)[] | null | undefined;

/* ────────────────────────── 时间 / 圆周工具（`src/time.js`） ────────────────────────── */

/** 一天秒数 */
export declare const SEC_PER_DAY: 86400;
/** 一天分钟数 —— SRI 的 epoch 粒度是 1 分钟，故 M = 1440 */
export declare const MIN_PER_DAY: 1440;

/** 取模到 `[0, m)`（默认 1440）。负数也落回正区间 */
export declare function mod(x: number, m?: number): number;
/** 算术均值；空数组返回 `0`（与移植前实现一致，调用方负责判空） */
export declare function avg(a: readonly number[]): number;

/**
 * epoch 秒 → 该时区下的自然日 `'YYYY-MM-DD'`。
 * @throws {TypeError} `tz` 不是有限数或超出 `[−12, +14]`（显式 `null` / `undefined` ⇒ 默认 8）
 */
export declare function dayOf(ts: number, tz?: TzOffset | null): string;
/** 自然日 `'YYYY-MM-DD'` → 该日 00:00（该时区）的 epoch 秒。@throws {TypeError} 同 `dayOf` */
export declare function dayStartSec(ds: string, tz?: TzOffset | null): number;
/** epoch 秒 → 当日「距 00:00 的分钟数」（0..1439）。@throws {TypeError} 同 `dayOf` */
export declare function clockMin(ts: number, tz?: TzOffset | null): number;

/**
 * 圆周均值（分钟）。空输入返回 `null`。
 * ⚠️ 入睡点一律用它 —— 23:50 与 00:10 的**算术**平均是 12:00，那是错的。
 */
export declare function circMean(mins: readonly number[]): number | null;
/** 圆周差（分钟，取较短路径，带符号 `−720..720`）—— mctq 推荐的 shorter 口径 */
export declare function circDiff(a: number, b: number): number;

/** 圆周统计的返回（`circStats()`）。 */
export interface CircStats {
  /** 样本数 */
  n: number;
  /** 圆周均值（分钟 0..1439）；空输入为 `null` */
  mean: number | null;
  /** 圆周标准差（分钟）；`n < 2` 或分布发散时为 `null` */
  sd: number | null;
  /** 合向量长度（0~1，越大越集中）；发散时为 `null` */
  R: number | null;
}

/**
 * 圆周统计三件套：集中趋势 + 离散度 + 集中度。
 * ⚠️ `sd` 与 `R` 要一起读 —— `R` 小于约 0.3 时标准差的意义已经很弱。
 * ⚠️ 四个正交方向的合向量在浮点下不会**正好**为零 ⇒ `R` 太小则 `sd` 返回 `null`，
 *    而不是给出"看着像数的胡说值"。
 */
export declare function circStats(mins: readonly number[]): CircStats;

/* ────────────────────────── 记录规范化与筛选（`src/records.js`） ────────────────────────── */

/**
 * 规范化：丢掉 bed/wake 非法（非正、不可表示、跨度过大…）的记录，补 `dur`，按 `bed` 升序。
 * @param records 非数组 ⇒ 返回 `[]`（不抛、不猜；README 的「两种失败模式」一节按此读）
 * @param tz 记录未带 tz 时的默认时区（记录级不合法只回退、不抛 —— 那条路径由 `auditRecords()` 报出来）
 * @returns 新数组（不修改入参）
 */
export declare function normalize(records: RecordsInput, tz?: TzOffset | null): NormalizedRecord[];

/** 全部睡眠段（含小睡）—— **SRI 必须用它**：小睡也是「睡着」 */
export declare function allSleep(records: RecordsInput, tz?: TzOffset | null): NormalizedRecord[];

/**
 * 主睡眠 —— 单段时长**严格大于** `minMinutes`（默认 180）。
 * ⚠️⚠️ **它不按天去重，也不过问这段落在夜里还是白天**：同一天若有「夜里一段 + 白天补觉」，
 *     **两段都会在结果里**。单晚趋势分析请用 `dailyMain()` —— 它们的差异由测试钉住，别"统一"。
 * @param minMinutes ⚠️ 只收数字，**不收 `null`** —— `null` 会被当成「门槛 0」，静默改变语义
 */
export declare function mainSleep(
  records: RecordsInput,
  minMinutes?: number,
  tz?: TzOffset | null,
): NormalizedRecord[];

/**
 * **每醒来日取最长一段**的主睡眠 —— 与建议引擎口径一致（门槛是 `>=`，且按天去重）。
 * ⚠️ 与 `mainSleep()` 有两处刻意差异，别"统一"：① 按醒来日只留最长一段；② 门槛 `>=` 而非 `>`。
 * @returns 每个醒来日至多一条，按 `bed` 升序
 */
export declare function dailyMain(
  records: RecordsInput,
  minMinutes?: number,
  tz?: TzOffset | null,
): NormalizedRecord[];

/* ────────────────────────── SRI（`src/sri.js`） ────────────────────────── */

/**
 * 建「每天一条 24h 睡/醒二值序列」（1=睡 0=醒）。睡眠时段按真实时刻落到自然日，跨午夜自动拆两天。
 * @param records 规范化后的记录（含 `bed` / `wake` / `stages`）；**导出供检查用**
 * @param tz 参考时区；缺省时**从记录的 `tz` 推断**（多个不同 tz ⇒ 锁定 `+8` 这个**妥协值**，并由 `auditRecords()` 的 `tz.mixed` 提示）
 * @returns 自然日 → 1440 长度的 `Uint8Array`
 *   ⚠️ **非数组返回 `null`**（JSDoc 原来只写了 `Map`、漏了这条 —— **2026-10-16 已修正**）
 */
export declare function buildGrid(
  records: RecordsInput,
  tz?: TzOffset | null,
): Map<string, Uint8Array> | null;

/** `computeSRI()` / `sriLastN()` 的返回。 */
export interface SRIResult {
  /**
   * **−100~100**（不是 0~100 的「分数」）。
   * `null` = **没有任何「相邻且有效」的天对** —— 这是关于**数据**的陈述，不是关于睡眠的。
   */
  sri: number | null;
  /** 参与计算的有效天数 */
  days: number;
  /** 天对数（相邻两天都通过有效天门槛才算一对） */
  pairs: number;
  /** 窗口内第一天（`YYYY-MM-DD`） */
  from: string | null;
  /** 窗口内最后一天 */
  to: string | null;
  /** 被有效天门槛（`minDayMinutes`）整个剔除的自然日 */
  skipped: string[];
}

/** 三个入口共用的选项。 */
export interface SRIOptions {
  /** 有效天门槛（分钟，默认 180）；某天睡不够就当它「无效」而非「全醒」 */
  minDayMinutes?: number;
  /** 参考时区；缺省从记录推断（见 `buildGrid`） */
  tz?: TzOffset | null;
}

/**
 * 计算 SRI。只对**相邻自然日且都有效**的天对计算，中间缺天的整段跳过。
 * @returns 非数组输入返回 `null`（不猜）
 */
export declare function computeSRI(records: RecordsInput, opts?: SRIOptions | null): SRIResult | null;

/**
 * 窗口 SRI 的**统一入口** —— 锚点取「主睡眠最后一条的醒来时间」（不是当天最后一条，那通常是午睡）。
 * @param allSegs 全部睡眠段（含小睡）—— 算 SRI 用它
 * @param mainSegs 主睡眠段 —— **只用来取窗口锚点**
 * @param w 窗口天数；`null` / `0` / `undefined` = 全量
 */
export declare function sriLastN(
  allSegs: RecordsInput,
  mainSegs: RecordsInput,
  w: number | null | undefined,
  opts?: SRIOptions | null,
): SRIResult | null;

/** `sriLeaveOneOut()` 里的一天。 */
export interface LOOEntry {
  /** 被去掉的那天（`YYYY-MM-DD`） */
  date: string;
  /** 去掉它之后的全量 SRI */
  sri: number | null;
  /** 相对基准的变化（**正 = 去掉它反而升 ⇒ 它在拖后腿**） */
  delta: number | null;
  /** 去掉它之后剩下的天对数 */
  pairs: number;
  /**
   * `true` = 这天**不参与任何天对**（邻居缺失或被剔除）⇒ 去掉它当然没变化。
   * ⚠️ 这**不代表「它很规律」**，恰恰相反。
   */
  isolated: boolean;
}

/** `sriLeaveOneOut()` 的返回。 */
export interface LOOResult {
  /**
   * 基准 SRI（没有「相邻且有效」的天对时为 `null`）。
   * ⚠️ typedef 原来把这个字段写成 `base`，而实现返回的是 `sri`（`bin/` 也按 `sri` 读）
   *    —— **2026-10-16 已修正**。
   */
  sri: number | null;
  /** 有效天数 */
  days: number;
  /** 天对数 */
  pairs: number;
  /** 逐日影响度（按日期升序） */
  out: LOOEntry[];
}

/**
 * ★ leave-one-day-out 影响度 —— 回答「**哪一晚在拖后腿**」。
 * ⚠️ **只在小窗口上有诊断力**：n=7 时一晚值 ±11 分，n=85 时不到 ±1 分 —— 那是噪音，不是"它很规律"。
 */
export declare function sriLeaveOneOut(
  allSegs: RecordsInput,
  mainSegs?: RecordsInput,
  w?: number | null,
  opts?: SRIOptions | null,
): LOOResult | null;

/** `sriBootstrap()` 的返回。 */
export interface SRIBootstrapResult {
  /** 点估计 —— 与 `computeSRI().sri` **同一口径**（不重算、不另设公式） */
  sri: number | null;
  /** 区间下界（百分位法）；没有任何天对时为 `null` */
  lo: number | null;
  /** 区间上界；没有任何天对时为 `null` */
  hi: number | null;
  /** 置信水平（默认 0.95） */
  level: number;
  /** 重抽样次数（默认 2000） */
  resamples: number;
  /** 块长（默认 2，**已按天对数夹过**） */
  block: number;
  /** 种子 —— **同一种子 ⇒ 同一区间**（可复现） */
  seed: number;
  /**
   * **恒为 `'day-pair'`**：重抽样的单位是**天对**，不是 epoch。
   * ⚠️ 一晚之内的分钟高度自相关，按 epoch 抽会得到**假窄**的区间 —— 这个字段就是在说"我们没这么干"。
   */
  unit: 'day-pair';
  /**
   * `true` = 天对少于 2 ⇒ 区间退化成一个点。
   * ⚠️ **不代表「很确定」**，恰恰相反：没有相邻天对就估不出宽度。
   */
  degenerate: boolean;
  /** 参与计算的有效天数 */
  days: number;
  /** 天对数（= 重抽样的样本量） */
  pairs: number;
  /** 窗口内第一天（`YYYY-MM-DD`） */
  from: string | null;
  /** 窗口内最后一天 */
  to: string | null;
  /** 被有效天门槛（`minDayMinutes`）整个剔除的自然日 */
  skipped: string[];
}

/** `sriBootstrap()` 的选项：网格口径（`SRIOptions`）＋重抽样参数。 */
export interface SRIBootstrapOptions extends SRIOptions {
  /** 置信水平，`0 < level < 1`（默认 0.95）；越界抛 `RangeError` */
  level?: number;
  /** 重抽样次数（≥1 的整数，默认 2000） */
  resamples?: number;
  /** 种子（有限数，默认 20261016）—— 决定区间，喂同一个种子就得到同一个结果 */
  seed?: number;
  /** 块长（≥1 的整数，默认 2）—— **保留依赖结构**的参数，不是"保守度"旋钮 */
  block?: number;
}

/**
 * ★ SRI 的 **bootstrap 置信区间** —— 回答「这一个数字有多可信」。
 * ⚠️ **单位是天对，不是 epoch**（`unit` 字段会说明）；**小 n 上很宽，而宽就是结论**。
 * @returns 非数组输入返回 `null`（不猜）
 */
export declare function sriBootstrap(
  allSegs: RecordsInput,
  mainSegs?: RecordsInput,
  w?: number | null,
  opts?: SRIBootstrapOptions | null,
): SRIBootstrapResult | null;

/* ────────────────────────── IS / IV（`src/rhythm.js`） ────────────────────────── */

/** `computeIS()` 的返回。 */
export interface ISResult {
  /** 日间稳定性（0~1，**越大越稳**） */
  is: number;
  /** 观测点数 */
  n: number;
  /** 每天的点数 */
  perDay: number;
  /** 天数 */
  days: number;
}

/** `computeIV()` 的返回。 */
export interface IVResult {
  /** 日内变异性（**越小越平稳**） */
  iv: number;
  /** 观测点数 */
  n: number;
}

/**
 * 日间稳定性 IS（van Someren 1999）。
 *
 * ⚠️⚠️ **口径警告，必须随结果一起读**：IS / IV 的定义建立在 **activity counts** 上。
 *    · 传真的 counts ⇒ 可与文献对照；
 *    · 传睡/醒二值序列（0/1）⇒ 得到的是**退化形式**，仍能回答"作息稳不稳"，
 *      但**数值不可**与 counts 研究对照 —— 量纲与分布都不同。
 *
 * ⚠️ 前置条件（不满足时返回 `null`，不猜）：序列**等间隔**（你保证的，函数无法验证）、
 *    长度是 `perDay` 的整数倍、至少两天、总方差非零、中间运算不溢出。
 */
export declare function computeIS(
  values: readonly number[],
  opts?: { perDay?: number } | null,
): ISResult | null;

/**
 * 日内变异性 IV。
 * ⚠️ 它只看**相邻两点之差** ⇒ 对采样间隔敏感：间隔不同，同一段记录的 IV 不可比。
 * ⚠️ 少于 3 点、序列非法、常数序列或中间运算溢出 ⇒ `null`。
 */
export declare function computeIV(values: readonly number[]): IVResult | null;

/* ────────────────────────── 睡眠相位（`src/phase.js`） ────────────────────────── */

/**
 * `computePhase()` 的正常返回。
 * 所有时刻都是「当天 0 点起的分钟数」（跨午夜继续累加，可能 > 1440）。
 *
 * ⚠️ 本类型是**判别联合**的一半（见 `PhaseResult`）：数据不足时实现返回的是
 *    `PhaseInsufficient`，其余字段**根本不存在**。JSDoc 把它们写成「可选」，
 *    那样 `result.insufficient` 检查之后 TS 仍会认为 `msfsc` 存在 —— 于是使用者的判空被绕过。
 */
export interface PhaseOk {
  insufficient?: false;
  /** 窗口天数（以最后一条主睡眠为锚往回数） */
  windowDays: number;
  /** 窗口内工作日数 */
  nW: number;
  /** 窗口内休息日数 */
  nF: number;
  /** 工作日入睡时刻（**圆周均值**，分钟） */
  soW: number;
  /** 休息日入睡时刻（**圆周均值**，分钟） */
  soF: number;
  /** 工作日平均睡眠时长（分钟） */
  sdW: number;
  /** 休息日平均睡眠时长（分钟） */
  sdF: number;
  /** 整周加权平均时长（分钟） */
  sdWeek: number;
  /** 工作日睡眠中点 */
  msw: number;
  /** 休息日睡眠中点 */
  msf: number;
  /**
   * 校正后的 MSF。
   * ⚠️ **本库恒按自由日算**（mctq 规定「休息日靠闹钟醒」时为 NA，但手环数据判断不了闹钟）。
   * 拿别的数据集比对时要记得这条**已知口径差，不是 bug**。
   */
  msfsc: number;
  /** 社交时差 `MSF − MSW`（分钟） */
  sjl: number;
  /** 用 `MSFsc` 算的社交时差（分钟） */
  sjlSc: number;
  /** 窗口内第一天（`YYYY-MM-DD`） */
  from: string;
  /** 窗口内最后一天 */
  to: string;
}

/** 窗口内缺工作日或缺休息日 ⇒ 算不出相位，**其余字段不存在**。 */
export interface PhaseInsufficient {
  insufficient: true;
  windowDays: number;
  /** 窗口内工作日数（可能为 0） */
  nW: number;
  /** 窗口内休息日数（可能为 0） */
  nF: number;
}

/** `computePhase()` 的返回（判别联合；见 `PhaseOk` 的说明）。 */
export type PhaseResult = PhaseOk | PhaseInsufficient;

/**
 * 睡眠相位：MSW / MSF / MSFsc / 社交时差 SJL。
 * @param records **主睡眠**记录（按 `bed` 升序 —— 一般来自 `mainSleep()`）
 * @param isRest 休息日判定函数（**由调用方注入**，见 `makeRestJudge`）—— 库不认识日历
 * @returns 非数组 ⇒ `null`；数据不足 ⇒ `PhaseInsufficient`
 */
export declare function computePhase(
  records: RecordsInput,
  isRest: (ds: string) => boolean,
  opts?: { windowDays?: number; tz?: TzOffset | null } | null,
): PhaseResult | null;

/** 分钟 → `'HH:MM'`（0..1439，自动取模）；给报告 / CLI 用，便于人读。非有限数 ⇒ `null` */
export declare function minToClock(m: number | null | undefined): string | null;

/** `chronotype()` 的返回。 */
export interface ChronotypeBucket {
  /** 档位名（`labels` 合法时取它，否则 `'1'…'n'`） */
  label: string;
  /** 档位下标（0 起，可能 = `cuts.length`） */
  index: number;
  /** ⚠️ 这是**你传入的那个数组的引用**（未被复制），别在原地改它 */
  cuts: readonly number[];
}

/**
 * 时型分档（chronotype）—— **切点由调用方注入，本库不写死任何钟点**。
 * 为什么：文献里常用的做法是按**人群分布的分位**分档（如 MSFsc 五分位），固定钟点会随人群 /
 * 季节 / 纬度漂移。本库不编切点，只做映射。
 * @param cuts 递增切点，长度 = 档数 − 1；非递增 / 空 / 非数字 ⇒ `null`（不猜）
 * @param labels 长度必须 = `cuts.length + 1`，否则**静默退回** `'1'…'n'`
 */
export declare function chronotype(
  msfscMinutes: number,
  opts?: { cuts: readonly number[]; labels?: readonly string[] } | null,
): ChronotypeBucket | null;

/** `compareChronotype()` 的返回。 */
export interface ChronotypeComparison {
  /** 两者相差是否在 `tolerance` 档以内 */
  agree: boolean;
  /** `activityIndex − questionnaireIndex` */
  delta: number;
  direction: 'same' | 'activity-later' | 'activity-earlier';
  activity: { index: number; label: string };
  questionnaire: { index: number; label: string };
  /**
   * 人话解释。⚠️ **两者不一致不是问题，是常态** —— 问卷测的是**偏好**，活动记录测的是**行为**。
   * 本函数**不做诊断、不判断谁对谁错，也不构成任何健康结论**。
   */
  note: string;
  /** 医学免责（**必须原样透出给你的用户**） */
  disclaimer: string;
}

/**
 * **双口径时型对比** —— 把「活动记录算出的档位」与「问卷给出的档位」放在一起。
 * ⚠️ 本库**不实现任何量表**（PSQI / MEQ / ESS 有版权、也有临床属性）：只接受你已经算好的档位，
 *    两边**必须用同一组 cuts**。
 * @returns 两个 index 非非负整数 ⇒ `null`（不猜）
 */
export declare function compareChronotype(opts?: {
  activityIndex: number;
  questionnaireIndex: number;
  labels?: readonly string[] | null;
  /** 差几档以内算"一致"（默认 0） */
  tolerance?: number;
} | null): ChronotypeComparison | null;

/* ────────────────────────── 数据体检（`src/audit.js`） ────────────────────────── */

/** 问题严重度。`error` ⇒ 先修数据再算指标（这些记录 `normalize()` 会直接丢掉）。 */
export type AuditSeverity = 'error' | 'warn' | 'info';

/** 体检出的一条问题。 */
export interface AuditIssue {
  /** 规则标识（如 `records.overlap`、`records.ghost-fragment`、`tz.out-of-range`、`stages.no-awake`） */
  ruleId: string;
  severity: AuditSeverity;
  /** 人话描述 */
  message: string;
  /** 相关记录下标 */
  index?: number;
  /**
   * 相关分段下标。
   * ⚠️ typedef 原本把这个字段写成 `stageIndex`（该名字在仓库里只存在于那行注释、从未被赋值）；
   *    **2026-10-16 已把 JSDoc 修正为 `stage`**，与实现一致。
   */
  stage?: number;
  /** 相关自然日（`YYYY-MM-DD`）。⚠️ typedef 里有这个字段，但**当前实现从未填过它** */
  ds?: string;
}

/** 体检汇总（**不是「数据质量评分」** —— 那会诱导人盯一个分数，而不是去看哪条坏了）。 */
export interface AuditSummary {
  /** 可用的记录条数（= `normalize()` 收下的条数，同一个数据集不许有两个「几条」） */
  records: number;
  /** 覆盖的自然日数 */
  days: number;
  /** 缺主睡眠（`< minMainMinutes`）的天数 */
  daysWithoutMainSleep: number;
  bySeverity: { error: number; warn: number; info: number };
  /**
   * `error` 与 `warn` 都为 0 才是 `true`（`info` 不影响它）。
   * ⚠️ typedef 原来只写了「`false` = 有 `error` 级问题」，漏掉了 `warn` —— **2026-10-16 已修正**。
   */
  ok: boolean;
}

/** `auditRecords()` 的返回。 */
export interface AuditResult {
  /** 问题清单（按发现顺序 —— 顺序是语义：先说病因，再说后果） */
  issues: AuditIssue[];
  summary: AuditSummary;
}

/**
 * 数据体检 —— 输入标准记录数组，输出**问题清单**（纯函数、**不修改数据**）。
 *
 * 为什么需要它：**脏数据从不报错**。它只会让 SRI 变成 61.5 而不是 41.2 —— 数字格式漂亮、
 * 含义却是空的。这个模块的职责就是**把沉默的错误变成可见的话**。
 *
 * ⚠️ 它是例外，**不许被脏数据搞崩**：输入不是数组、元素是 `null` / 字符串 / 数字、
 *    `tz: 480`…一律**报出来**（`input.not-array`、`time.looks-like-milliseconds`、
 *    `tz.out-of-range`…），而不是抛。所以这里的入参是 `unknown[]` —— 体检的职责就是吃脏数据。
 * @param opts ⚠️ 与其它入口不同：**选项非法（`tz` 不合法）会抛** —— 体检工具尤其不能对
 *   **配置**错误含糊。（记录级的 `tz` 不合法则只报 `tz.out-of-range` + 回退默认值。）
 */
export declare function auditRecords(
  records: readonly unknown[] | null | undefined,
  opts?: { tz?: TzOffset | null; minMainMinutes?: number } | null,
): AuditResult;

/* ────────────────────────── 休息日判定（`src/rest.js`） ────────────────────────── */

/** 一张年份表（`data/holidays.json` 的形状；`source` 是备注，库不读它）。 */
export interface RestTable {
  [year: string]: {
    /** 法定放假日（即使是周中也休） */
    holidays?: readonly string[];
    /** 调休上班日（即使是周末也上班） */
    workdays?: readonly string[];
    /** 数据出处（给人看的，库里不用） */
    source?: string;
  } | undefined;
}

/**
 * `makeRestJudge()` 的返回 —— 「今天算不算自由日」的**唯一权威**。
 * ⚠️ 库不认识日历、也不假设任何人朝九晚五：这张表由**调用方注入**。
 */
export interface RestJudge {
  /** 自由日？（**调休上班优先否决**，否则「法定假日 ∪ 周末」） */
  isRest: (ds: string) => boolean;
  /** 法定假日？ */
  isHoliday: (ds: string) => boolean;
  /** 调休上班日？ */
  isMakeupWorkday: (ds: string) => boolean;
  /** 周末（**不考虑调休**）？ */
  isWeekend: (ds: string) => boolean;
  /** 表里有这一年的数据吗？ */
  hasYear: (ds: string) => boolean;
  /** 这些日期里哪些年份**没录** */
  missingYears: (dsList: readonly string[]) => string[];
  /** 表里录了哪些年份（升序） */
  loadedYears: () => string[];
}

/** `'YYYY-MM-DD'` → 星期几（0=周日 … 6=周六）。用 UTC 正午取，避免宿主时区把日期挪一天 */
export declare function dowOf(ds: string): number;
/** 是否周末（**不考虑调休**） */
export declare function isWeekend(ds: string): boolean;

/**
 * 用一张表造出判定函数族。
 * ⚠️ 缺年份**不报错**（退化成只按周末），但 `missingYears()` 让上层能明说
 *    「我不知道这一年的调休」—— **悄悄给错建议比报错更坏**。
 */
export declare function makeRestJudge(table?: RestTable | null): RestJudge;

/* ────────────────────────── 建议引擎（`src/suggest.js`） ────────────────────────── */

/** 目标睡眠时长（分钟，默认 7h30） */
export declare const DEFAULT_TARGET_MINUTES: 450;
/** 入睡潜伏（分钟）—— 上床到睡着要预留的时间 */
export declare const DEFAULT_LATENCY_MINUTES: 15;
/** 催睡闸门的时间窗起点（分钟，21:00；跨午夜） */
export declare const NIGHT_START_MINUTES: 1260;
/** 催睡闸门的时间窗终点（分钟，06:00） */
export declare const NIGHT_END_MINUTES: 360;
/** 超过建议上床点多久才算「真晚了」（分钟） */
export declare const LATE_MINUTES: 30;

/**
 * 把钟表分钟归一到「凌晨算作前一天深夜」的坐标系（`< 12:00` ⇒ `+24h`）。
 * ⚠️ 比较跨午夜的两个时刻前**双方都要归一**，否则差值会差整整一天。
 */
export declare function normalizeNight(m: number): number;

/** `suggest()` 的选项。 */
export interface SuggestOptions {
  /** 当前 epoch **秒**（默认取系统时间） */
  now?: number;
  /** 休息日判定（注入）；缺省视同「每天都是工作日」 */
  isRest?: (ds: string) => boolean;
  targetMinutes?: number;
  latencyMinutes?: number;
  tz?: TzOffset | null;
}

/** 一条**可追溯**的理由：`ruleId` + 触发它的数字。 */
export type SuggestReason =
  | { ruleId: 'wakeTarget.rest'; text: string; numbers: { medianMinutes: number; n: number } }
  | { ruleId: 'wakeTarget.rest.fallback'; text: string; numbers: { workMedianMinutes: number; plusMinutes: number } }
  | { ruleId: 'wakeTarget.work'; text: string; numbers: { medianMinutes: number; n: number } }
  | {
    ruleId: 'bedtime.backward';
    text: string;
    numbers: { wakeTarget: number; targetMinutes: number; latencyMinutes: number; bedtime: number };
  };

/** 一条**事实**（不是建议）—— 近 7 晚的客观数字。 */
export interface SuggestFact {
  ruleId: 'fact.recent7';
  text: string;
  numbers: {
    n: number;
    avgDurationMinutes: number;
    /** ⚠️ **圆周均值**，不是算术平均 */
    bedtimeCircMeanMinutes: number;
    /** 最短的两晚（按 `dur` 升序，最多 2 条） */
    shortestTwoNights: Array<{ ds: string; durationMinutes: number }>;
  };
}

/**
 * `suggest()` 的正常返回 —— 今晚的建议上床点，以及**每条理由背后的数字**。
 * ⚠️ 时刻都是「当日 0 点起的分钟数」（`bedtime` 自动取模到 0..1439）。
 */
export interface SuggestOk {
  insufficient?: false;
  /** 今天（`YYYY-MM-DD`，按 `tz`） */
  today: string;
  /** 明天 */
  tomorrow: string;
  tomorrowIsRest: boolean;
  /** 目标起床点（分钟，取自中位数） */
  wakeTarget: number;
  /** 建议上床点（分钟） */
  bedtime: number;
  /** 本次生效的目标时长（回显，便于解释） */
  targetMinutes: number;
  /** 本次生效的入睡潜伏（回显） */
  latencyMinutes: number;
  reasons: SuggestReason[];
  facts: SuggestFact[];
  /** 医学免责（**必须原样透出给你的用户**） */
  disclaimer: string;
}

/** 没有主睡眠记录 ⇒ 算不出建议，**不硬算**。 */
export interface SuggestInsufficient {
  insufficient: true;
  reason: string;
  /** 医学免责 —— 这条分支也带它 */
  disclaimer: string;
}

/** `suggest()` 的返回（判别联合）。 */
export type SuggestResult = SuggestOk | SuggestInsufficient;

/**
 * 算今晚的建议上床点，并把理由逐条摊开。
 *
 * ⚠️ 红线：**不自创算法**（只有移植来的既有规则 + 有文献出处的指标，没有「睡眠债 = 累计缺口」这类
 *    无出处口径）；**每条输出都带 `disclaimer`**，用它的人必须原样透出。
 * ⚠️ 本函数**纯函数、无状态** —— 不读文件、不落盘、不起定时器。「一晚最多提醒一次」由调用方管理。
 * ⚠️ 它不是 `mainSleep()` 口径：内部走 `dailyMain()`（每醒来日最长一段、门槛 `>=`）。
 */
export declare function suggest(records: RecordsInput, opts?: SuggestOptions | null): SuggestResult;

/** `nudgeDecision()` 的选项。 */
export interface NudgeOptions {
  /** 现在几点（当日分钟，0..1439） */
  nowMinutes: number;
  /** 建议上床点（分钟） */
  bedtimeMinutes: number;
  /** 今天已经提醒过几次（默认 0） */
  saidToday?: number;
  /** 超过建议上床点多久才算「真晚了」（默认 `LATE_MINUTES` = 30） */
  lateMinutes?: number;
  /** 时间窗起点（默认 21:00） */
  nightStartMinutes?: number;
  /** 时间窗终点（默认 06:00） */
  nightEndMinutes?: number;
}

/**
 * 催睡闸门的判定结果（判别联合：`allowed` 与 `ruleId` 一一对应）。
 *
 * ⚠️ **它不带 `DISCLAIMER`** —— `nudgeDecision()` 的四个分支都没有 `disclaimer` 字段
 *    （`suggest()` 与 `compareChronotype()` 才有）。`src/disclaimer.js` 与 README 原先都写着
 *    「每一个 advisory 返回值都带 `DISCLAIMER`」，与实现不符；**2026-10-16 已改成「它不带」**
 *    并写明理由：闸门判定回答的是"提醒该不该发"，不是对睡眠者的评价。
 */
export type NudgeDecision =
  | { allowed: true; ruleId: 'nudge.allowed'; reason: string; deltaMinutes: number }
  | {
    allowed: false;
    ruleId: 'nudge.outside-window' | 'nudge.too-early' | 'nudge.already-said';
    reason: string;
    deltaMinutes: number;
  };

/**
 * 催睡闸门 —— 纯判定，**不落盘**（「一晚最多一次」的记性由调用方负责）。
 * 允许提醒的三个条件（全部满足）：① 在 21:00 ~ 次日 06:00 内；② 超过建议上床点 ≥ `lateMinutes`；
 * ③ 今天还没说过。
 */
export declare function nudgeDecision(opts?: NudgeOptions | null): NudgeDecision;

/* ────────────────────────── 医学免责（`src/disclaimer.js`） ────────────────────────── */

/**
 * 医学免责 —— **全库唯一来源**。
 * ⚠️ 硬规矩：任何「建议类 / 解释类」输出都必须带上它，用它的人**必须原样透出**。
 *    指标类纯数字（`computeSRI()` 等）不带 —— 那是计算的返回值，不是对你的评价。
 */
export declare const DISCLAIMER: string;
