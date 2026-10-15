/**
 * SRI —— 睡眠规律性指数（Sleep Regularity Index）
 *
 * 提出：Phillips AJK et al., Sci Rep 2017;7:3216  (doi:10.1038/s41598-017-03171-4)
 * 公式：Lunsford-Avery JR et al., Sci Rep 2018;8:14158  Methods 式(1)
 *
 *   SRI = -100 + ( 200 / (M·(N-1)) ) · Σ_j Σ_i δ(s_{i,j}, s_{i+1,j})
 *
 *   M = 每天的 epoch 数（本实现 = 1440，粒度 1 分钟）
 *   N = 参与比对的天数；s_{i,j} = 第 j 天第 i 个 epoch 的状态（睡/醒）
 *   δ(a,b) = a 与 b 相同则 1，否则 0（比对的是相隔 24h 的同一时刻）
 *
 * 语义：完全规律 = 100，完全随机 = 0。**与睡眠时长不相关（r=0.05）** —— 它是独立维度，
 *      别拿它当「睡得好不好」的替身。
 *
 * ⚠️ **口径冻结（改它会动数字）**：本实现**逐位对齐** `mifit/metrics.mjs` 的 2026-10-11 修正后口径，
 *    并由 `test/regression.test.js` 钉死（真实数据锚点：全量 **74.108** / 近 7 晚 **65.972**）。
 *    按 `RELEASE.md` §2：会动数字的改动升 **minor 或 major**，**不是** patch。
 *
 * ⚠️ **已知的简化（口径边界，别混用）**：此处的 δ 用「**睡/醒二值**」；文献里也存在用
 *    **活动计数（activity counts）** 算 SRI 的变体 —— 两种口径的数值**不可直接比较**。
 *    与 counts 口径的论文对照时，先确认对方用的是哪一种。
 *    （`IS` / `IV` 见 `src/rhythm.js` —— 它们定义在 counts 上、自带口径警告，别与本函数的二值口径混用。）
 *
 * ⚠️ 移植语义（项目方案 §十一 第 2/3/4 条，逐条对应一次实测）：
 *   2. **小睡要算进 SRI**（睡着就是睡着）⇒ 传进来的应是 allSleep 而不是 mainSleep；
 *   3. **有效天门槛**：当天「睡着」总时长 < minDayMinutes（默认 180）的天**整个剔除**，
 *      不参与任何天对。旧实现只要求「当天有任意一段睡眠」，于是「主睡眠缺失、只剩 26 分钟小睡」
 *      的那天整天按「醒」参与比对 —— 实测本机把近 7 晚白拉低 **9.5 分**（56.5 → 66.0）。
 *      传 `{ minDayMinutes: 0 }` 可复现旧口径（仅用于对照历史锚点，别当默认）；
 *   4. **窗口锚点只允许有一处** —— 见 `sriLastN()`。拿「当天最后一段睡眠」（往往是小睡）当锚，
 *      窗口会整体前移一天：同一个「近 7 晚」能算出两个值（实测 66.0 vs 61.0）。
 */
import { MIN_PER_DAY, SEC_PER_DAY, dayOf, dayStartSec } from './time.js';
// ⚠️ 时间戳可表示范围是**同一个判据**：`records.js` 用它决定「这条记录算不算数」，
//    这里用它保证 `buildGrid()` 的标记循环不会挂死。⇒ 共享常量，别各写一份（两份会漂）。
import { DATE_MAX_SEC } from './records.js';

/**
 * 建「每天一条 24h 睡/醒二值序列」（1=睡 0=醒）。
 * 睡眠时段按**真实时刻**落到对应自然日，跨午夜自动拆到两天。
 * 有 `stages` 就逐段标（state === 5 记「醒」）；没有就把整段按「睡」标（粗一点，但不丢天）。
 * @param {Array<object>} records 规范化后的记录（含 bed/wake/stages）
 * @param {number} [tz=8] 默认时区
 * @returns {Map<string, Uint8Array>} 自然日 → 1440 长度序列
 */
export function buildGrid(records, tz = 8) {
  if (!Array.isArray(records)) return null;   // 非数组 ⇒ 不猜（原来是 `records ?? []`，传数字会抛 not iterable）
  const grid = new Map();
  const ensure = (ds) => {
    if (!grid.has(ds)) grid.set(ds, new Uint8Array(MIN_PER_DAY));
    return grid.get(ds);
  };
  const mark = (from, to, val) => {
    // ★ 守卫（2026-10-15）：下面这个循环的迭代次数 ∝ `(to − from) / 60`。
    //   极端时间戳会让它**近乎永不返回** —— 实测 `wake = 6e8` 已要 6717 ms，
    //   `wake = 9e15` 约 1.5e14 次 ⇒ 等同挂死。抛错还看得见，**挂死看不见**。
    //   ⇒ 这里必须自己拦住：`buildGrid()` 是**导出函数**、可能被直接调用（不经过
    //     `normalize()`），不能指望上游已经筛过。判据与 `records.js` 的 `recordFaults()`
    //     保持一致：时间戳不可被 `Date` 表示 / 一段跨过一天 ⇒ 跳过。
    //   （真实数据实测：最长一段 9.57 h、最长的 stage 1.3 h ⇒ 余量充足。）
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    if (!(to > from)) return;
    if (Math.abs(from) > DATE_MAX_SEC || Math.abs(to) > DATE_MAX_SEC) return;
    if (to - from > SEC_PER_DAY) return;
    for (let t = Math.floor(from / 60) * 60; t < to; t += 60) {
      const ds = dayOf(t, tz);
      const idx = Math.floor((t - dayStartSec(ds, tz)) / 60);
      if (idx >= 0 && idx < MIN_PER_DAY) ensure(ds)[idx] = val;
    }
  };
  for (const r of records ?? []) {
    // ⚠️ 数组里的 null / 非对象元素必须跳过：`null.stages` 会抛 TypeError，
    //    而「脏数据从不报错、只会静静给出错数字」正是本库的招牌（`audit.js` 开篇）。
    //    `normalize()` 一直有这道守卫，`buildGrid` 漏了 —— 2026-10-13 实测 `computeSRI([null])` 直接崩。
    if (r === null || typeof r !== 'object') continue;
    if (r.stages && r.stages.length) {
      for (const st of r.stages) {
        // ⚠️ stages 里的脏元素（`null` / 非对象）也要跳过 —— 外部评审实测（2026-10-14）：
        //    `stages: [null]` 会让这里直接抛 TypeError。`normalize()` 现在会先过滤，
        //    但 `buildGrid()` 是导出函数、可能被直接调用 ⇒ 这一层也得守住。
        if (st === null || typeof st !== 'object') continue;
        mark(Number(st.start), Number(st.end), Number(st.state) === 5 ? 0 : 1);
      }
    } else {
      mark(r.bed, r.wake, 1);
    }
  }
  return grid;
}

/**
 * 计算 SRI。只对**相邻自然日且都有效**的天对计算 —— 中间缺天的整段跳过，
 * 免得拿一个「全醒日」去污染结果（§十一 第 3 条）。
 * @param {Array<object>} records 规范化后的记录（**应当含小睡**）
 * @param {{minDayMinutes?: number, tz?: number}} [opts]
 * @returns {{sri: number|null, days: number, pairs: number, from: string|null, to: string|null, skipped: string[]}}
 */
/**
 * ★ 把 SRI 拆成**天对清单** —— 让「SRI 是逐天对累加出来的」成为**代码里的形状**，而不只是一句注释。
 *
 * ⚠️ **观察单位是天对**（相隔 24h 的 1440 次比对），**不是 epoch**：同一天之内的 epoch 高度自相关，
 *    所以任何「重抽样 / 影响度 / 区间」都必须以**天（或天对）**为单位。
 *    按 epoch 处理会给出**假窄**的区间，看着权威、其实骗人 —— 见 `ROADMAP.md` 的 bootstrap 条目
 *    与 `sriLeaveOneOut()`。
 *
 * @param {Array<object>} records 规范化记录（**应当含小睡**）
 * @param {{minDayMinutes?: number, tz?: number}} [opts]
 * @returns {{days: string[], skipped: string[], dayPairs: Array<{a: string, b: string, same: number}>}}
 */
function decompose(records, { minDayMinutes = 180, tz = 8 } = {}) {
  const grid = buildGrid(records, tz);
  const asleepIn = (arr) => {
    let n = 0;
    for (let k = 0; k < MIN_PER_DAY; k += 1) if (arr[k]) n += 1;
    return n;
  };
  const allDays = [...grid.keys()].sort();
  const days = allDays.filter((ds) => asleepIn(grid.get(ds)) >= minDayMinutes);
  const skipped = allDays.filter((ds) => asleepIn(grid.get(ds)) < minDayMinutes);

  const dayPairs = [];
  for (let i = 0; i < days.length - 1; i += 1) {
    const gap = Math.round((dayStartSec(days[i + 1], tz) - dayStartSec(days[i], tz)) / SEC_PER_DAY);
    if (gap !== 1) continue; // 中间缺天的整段跳过（§十一 第 3 条）
    const a = grid.get(days[i]);
    const b = grid.get(days[i + 1]);
    let same = 0;
    for (let k = 0; k < MIN_PER_DAY; k += 1) if (a[k] === b[k]) same += 1;
    dayPairs.push({ a: days[i], b: days[i + 1], same });
  }
  return { days, skipped, dayPairs };
}

/** 天对 → SRI。`pairCount` 是**天对数**（与返回值的 `pairs` 同口径）。 */
const sriOf = (same, pairCount) => (pairCount ? -100 + (200 * same) / (pairCount * MIN_PER_DAY) : null);

/**
 * `computeSRI()` / `sriLastN()` 的返回。
 * @typedef {object} SRIResult
 * @property {number|null} sri 0~100；`null` = **没有任何「相邻且有效」的天对** —— 这是关于**数据**的陈述，不是关于睡眠的
 * @property {number} days 参与计算的有效天数
 * @property {number} pairs 天对数（相邻两天都通过有效天门槛才算一对）
 * @property {string|null} from 窗口内第一天（`YYYY-MM-DD`）
 * @property {string|null} to 窗口内最后一天
 * @property {string[]} skipped 被有效天门槛整个剔除的自然日
 */

/**
 * `sriLeaveOneOut()` 里的一天。
 * @typedef {object} LOOEntry
 * @property {string} date 被去掉的那天（`YYYY-MM-DD`）
 * @property {number|null} sri 去掉它之后的全量 SRI
 * @property {number|null} delta 相对基准的变化（**正 = 去掉它反而升 ⇒ 它在拖后腿**）
 * @property {number} pairs 去掉它之后剩下的天对数
 * @property {boolean} isolated `true` = 这天**不参与任何天对**（去掉它当然没变化）——
 *   ⚠️ 这**不代表「它很规律」**，恰恰相反（见 `sriLeaveOneOut()` 的注释）
 */

/**
 * `sriLeaveOneOut()` 的返回。
 * @typedef {object} LOOResult
 * @property {number} base 基准 SRI
 * @property {number} days 有效天数
 * @property {number} pairs 天对数
 * @property {Array<LOOEntry>} out 逐日影响度（按日期升序）
 */

/**
 * @param {import('./records.js').Record[]} records
 * @param {{minDayMinutes?: number, tz?: number}} [opts]
 * @returns {SRIResult|null} 非数组输入返回 `null`（不猜）
 */
export function computeSRI(records, opts = {}) {
  if (!Array.isArray(records)) return null;   // 非数组 ⇒ 不猜（见 records.js 顶部那条统一规则）
  const { days, skipped, dayPairs } = decompose(records, opts);
  const same = dayPairs.reduce((n, p) => n + p.same, 0);

  return {
    sri: sriOf(same, dayPairs.length),
    days: days.length,
    pairs: dayPairs.length,
    from: days[0] ?? null,
    to: days.at(-1) ?? null,
    skipped,
  };
}

/**
 * 窗口切片的**唯一实现** —— 锚点取「主睡眠最后一条的醒来时间」（§十一 第 4 条）。
 * `sriLastN()` 与 `sriLeaveOneOut()` 必须共用它，别再各写一份过滤（同一个「近 7 晚」曾经算出两个值）。
 * @param {Array<object>} allSegs @param {Array<object>} mainSegs @param {number|null|undefined} w
 */
function windowSlice(allSegs, mainSegs, w) {
  if (!w) return allSegs;
  const anchor = mainSegs?.at(-1)?.wake ?? allSegs?.at(-1)?.wake;
  if (!anchor) return [];
  return allSegs.filter((m) => m.wake >= anchor - w * SEC_PER_DAY);
}

/**
 * 窗口 SRI 的**统一入口**。
 * @param {Array<object>} allSegs 全部睡眠段（含小睡）—— 算 SRI 用它
 * @param {Array<object>} mainSegs 主睡眠段 —— **只用来取窗口锚点**
 * @param {number|null|undefined} w 窗口天数；null / 0 / undefined = 全量
 * @param {{minDayMinutes?: number, tz?: number}} [opts]
 */
export function sriLastN(allSegs, mainSegs, w, opts = {}) {
  if (!Array.isArray(allSegs)) return null;   // 非数组 ⇒ 不猜
  return computeSRI(windowSlice(allSegs, mainSegs, w), opts);
}

/**
 * ★ leave-one-day-out 影响度 —— 回答「**哪一晚在拖后腿**」。
 *
 * 为什么能做到：SRI 是天对累加出来的 ⇒ 剔除某一天，只需去掉**包含它的那些天对**
 * （中间的一天最多影响 2 对），**不必重跑全量**。这正是 `decompose()` 存在的理由。
 *
 * ⚠️ **两个必须读懂的口径**（后果都写进返回值，别让调用方猜）：
 *   1. **它只在「近 N 晚」这类小窗口上才有诊断力。** 全量 85 天时一天只占 1/78 权重，
 *      Δ 最大不到 ±1 分 —— 那看起来像噪音是**对的**；同样的算法在近 7 晚上能给出 ±11 分。
 *   2. `isolated: true` 的天**本来就没参与任何天对**（邻居缺失或被剔除）⇒ 去掉它当然没变化。
 *      **这不代表「它很规律」，恰恰相反** —— 必须显式标注，否则结论会被读反。
 *
 * @param {Array<object>} allSegs 全部睡眠段（含小睡）
 * @param {Array<object>} [mainSegs] 主睡眠段 —— **只用来取窗口锚点**（与 `sriLastN` 同一口径）
 * @param {number|null} [w] 窗口天数；null / 0 / undefined = 全量
 * @param {{minDayMinutes?: number, tz?: number}} [opts]
 * @returns {{sri: number|null, days: number, pairs: number, out: Array<{date: string, sri: number|null, delta: number|null, pairs: number, isolated: boolean}>}}
 */
export function sriLeaveOneOut(allSegs, mainSegs, w, opts = {}) {
  if (!Array.isArray(allSegs)) return null;   // 非数组 ⇒ 不猜
  const { days, dayPairs } = decompose(windowSlice(allSegs, mainSegs, w), opts);
  const baseSame = dayPairs.reduce((n, p) => n + p.same, 0);
  const base = sriOf(baseSame, dayPairs.length);

  // 每天 → 包含它的天对下标（剔除那天时跳过这些即可，O(1) per day）
  const touching = new Map();
  dayPairs.forEach((p, i) => {
    for (const ds of [p.a, p.b]) {
      let list = touching.get(ds);
      if (!list) { list = []; touching.set(ds, list); }
      list.push(i);
    }
  });

  const out = days.map((ds) => {
    const drop = touching.get(ds) ?? [];
    const dropped = drop.reduce((n, i) => n + dayPairs[i].same, 0);
    const pairCount = dayPairs.length - drop.length;
    const v = sriOf(baseSame - dropped, pairCount);
    return {
      date: ds,
      sri: v,
      delta: v === null || base === null ? null : v - base,
      pairs: pairCount,
      isolated: drop.length === 0,
    };
  });

  return {
    sri: base, days: days.length, pairs: dayPairs.length, out,
  };
}
