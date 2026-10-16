/**
 * 重抽样置信区间 —— **通用工具，零依赖**（PRNG 自带，不用 `Math.random`）。
 *
 * ⚠️⚠️ **本文件唯一不能忘的一条**：重抽样的单位必须是**观察单位**，不是原始采样点。
 *
 *   在 SRI 上这条特别要命：`SRI` 每天贡献 1440 次「同一钟点睡/醒是否一致」的比对，
 *   而**同一晚之内的 epoch 高度自相关**（一段睡眠就是连续几百个相同的 1）。
 *   于是按 epoch 重抽样会把「一晚内部的重复」当成 1440 份独立证据 ——
 *   区间会**假窄**，窄到看着权威、其实骗人。（`ROADMAP.md` 的 bootstrap 条目、
 *   `test/bootstrap.test.js` 里有一条专门拿这个反例对拍的测试。）
 *
 *   ⇒ 调用方负责把 values 传成**观察单位**的数组（SRI 就是「天对」），
 *     本模块不猜、也无法从数值上看出单位是什么 —— 所以它要求调用方把 `unit` 说清楚，
 *     并且**原样带进返回值**（`ROADMAP.md`：ship it only with that unit stated）。
 *
 * 其余三个刻意的选择：
 *   1. **PRNG 自带、不用 `Math.random`**：同一个输入必须给出**同一个区间**。
 *      "这批数据的 95% 区间是多少"是一个**可复现的事实**，不是每次刷新都变的数字 ——
 *      否则测试只能断言"大概在某个范围"，而本项目要的是能钉住的数字。
 *      （mulberry32：32 位状态，够用且可读；**不是密码学用途**。）
 *   2. **百分位法**，不是「点估计 ± 1.96·SE」：SRI 逼近 ±100 时分布是**偏的**，
 *      对称区间会越界（给出 >100 的上界）。百分位法天然不对称。
 *   3. **块重抽样（circular moving block）**：相邻观察单位**不独立**（相邻天对共享一天）。
 *      块长 2 恰好覆盖"共享一天"这层依赖 —— 见 `bootstrapCI` 的 `block` 说明。
 */

/** 默认重抽样次数。2000 次足够稳、又快到不值得一提（每次只是一次求和）。 */
export const DEFAULT_RESAMPLES = 2000;

/**
 * 默认种子。**写死的常量**，不是随机数：见文件头第 1 条。
 * （取值只是"2026-10-16 首次实现"这个日期，没有其它含义。）
 */
export const DEFAULT_SEED = 20261016;

/**
 * 默认块长 = 2 个观察单位。
 * ⚠️ 依据是**依赖结构**，不是"越大越保守"：SRI 的观察单位是天对，而**相邻两个天对共享一天**
 *   （对 i = 第 i 天↔第 i+1 天，对 i+1 = 第 i+1 天↔第 i+2 天）⇒ 它们的 `same` 不独立；
 *   再远的两个天对不共享任何一天。块长 1（= 把天对当独立样本）会**直接忽略**这层协方差。
 * ⚠️ **偏差的方向要实测才知道，不能凭直觉**：本仓库的合成数据上，块长 1 给出**更宽**的区间、
 *   块长 3 更窄 —— 那份数据里相邻天对是**负相关**的（i.i.d. 假设高估了不确定性）；
 *   换成"作息连续几晚朝同一方向漂"的数据，方向会反过来。
 *   ⇒ 块长是**保留依赖结构**的参数（`test/bootstrap.test.js` 钉住"它真的在起作用"，
 *     而不是一个摆着好看的旋钮），不要拿它当置信水平用。
 */
export const DEFAULT_BLOCK = 2;

/**
 * mulberry32 —— 32 位 PRNG，返回 `[0, 1)` 上的浮点数。
 * @param {number} seed 整数种子（内部按 `>>> 0` 取 32 位）
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = Number(seed) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 线性插值分位数（与 R 的 `quantile(type = 7)` / NumPy 默认同一口径）。
 * @param {number[]} sorted **已升序**的数组（本函数不排序 —— 排序一次、取两个分位）
 * @param {number} q `0 ≤ q ≤ 1`
 * @returns {number}
 */
export function percentile(sorted, q) {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  const frac = pos - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

/**
 * 环形移动块重抽样：抽出一个**等长**的重抽样样本。
 *
 * 「环形」= 块的起点可以靠近末尾、块尾绕回开头（`(start + j) % n`）——
 * 不这样的话，末尾那些单位只能以"块尾被截断"的形式被抽到，边界单位的入样概率就不等了。
 *
 * @template T
 * @param {T[]} values
 * @param {number} block 块长（会被夹到 `[1, n]`）
 * @param {() => number} rng
 * @returns {T[]} 长度与 `values` 相同的重抽样样本（元素可重复）
 */
export function circularBlockSample(values, block, rng) {
  const n = values.length;
  const b = Math.max(1, Math.min(Math.floor(block) || 1, n));
  const out = new Array(n);
  let k = 0;
  while (k < n) {
    const start = Math.floor(rng() * n);
    for (let j = 0; j < b && k < n; j += 1) {
      out[k] = values[(start + j) % n];
      k += 1;
    }
  }
  return out;
}

/**
 * 对一个「观察单位数组」做 bootstrap 置信区间。
 *
 * ⚠️ `values` 的**每一个元素 = 一个观察单位**，不是原始采样点 —— 见文件头。
 *    传 epoch 进这里（哪怕代码跑得通）得到的就是那个**假窄**的区间。
 *
 * ⚠️ **本函数刻意不对外导出**（`src/index.js` 上没有它）：单位不是"选项"。
 *    库只提供按**天对**的那一个入口（`sri.js` 的 `sriBootstrap()`）——
 *    给出一个"你自己选单位"的工具，等于把 ROADMAP 记的那条红线交给使用者去踩。
 *
 * 返回对象的字段：
 *   · `point` / `lo` / `hi` —— 点估计与区间两端（**没有单位时三者都是 `null`**）；
 *   · `level` / `resamples` / `block` / `seed` —— **实际用了什么**（`block` 已按单位数夹过）；
 *   · `unit` —— 单位的名字，原样回带（`null` = 调用方没说清）；
 *   · `units` —— 观察单位数；
 *   · `degenerate` —— `true` = 单位 < 2，区间退化成**一个点**。
 *     ⚠️ 那**不代表"没有不确定性"**，恰恰相反：没有证据就估不出宽度。
 *     必须显式标注，否则 `lo === hi` 会被读成"很确定"（与 `sriLeaveOneOut` 的 `isolated` 同一类陷阱）。
 *
 * @template T
 * @param {T[]} values 观察单位数组（SRI 用「天对」）
 * @param {object} opts
 * @param {(sample: T[]) => number} opts.statistic 统计量（接收一次重抽样，返回一个数）
 * @param {number} [opts.level] 置信水平，`0 < level < 1`（默认 0.95）
 * @param {number} [opts.resamples] 重抽样次数（正整数，默认 2000）
 * @param {number} [opts.seed] 种子（默认 20261016）
 * @param {number} [opts.block] 块长（正整数，默认 2，说明见 `DEFAULT_BLOCK`）
 * @param {string} [opts.unit] 观察单位的名字（如 `'day-pair'`）—— **原样带进返回值**，
 *   因为「区间有多宽」这件事**离开单位就没法读**：同一个宽度按天的口径和按 epoch 的口径含义完全不同。
 * @returns {{
 *   point: number|null, lo: number|null, hi: number|null, level: number,
 *   resamples: number, block: number, seed: number, units: number,
 *   unit: string|null, degenerate: boolean,
 * }|null} **非数组输入 ⇒ `null`**（与库内其它入口同一规矩：不猜）
 */
export function bootstrapCI(values, opts = {}) {
  if (!Array.isArray(values)) return null;
  const {
    statistic,
    level = 0.95,
    resamples = DEFAULT_RESAMPLES,
    seed = DEFAULT_SEED,
    block = DEFAULT_BLOCK,
    unit = null,
  } = opts ?? {};

  if (typeof statistic !== 'function') throw new TypeError('bootstrapCI：statistic 必须是函数');
  if (!Number.isFinite(level) || !(level > 0) || !(level < 1)) {
    throw new RangeError(`bootstrapCI：level 必须在 (0, 1) 内，收到 ${JSON.stringify(level)}`);
  }
  if (!Number.isInteger(resamples) || resamples < 1) {
    throw new RangeError(`bootstrapCI：resamples 必须是 ≥ 1 的整数，收到 ${JSON.stringify(resamples)}`);
  }
  if (!Number.isInteger(block) || block < 1) {
    throw new RangeError(`bootstrapCI：block 必须是 ≥ 1 的整数，收到 ${JSON.stringify(block)}`);
  }
  if (!Number.isFinite(seed)) {
    throw new RangeError(`bootstrapCI：seed 必须是有限数，收到 ${JSON.stringify(seed)}`);
  }

  const n = values.length;
  const meta = { level, resamples, seed, block: Math.max(1, Math.min(block, n || 1)), units: n, unit };

  // 没有观察单位 ⇒ 不调用 statistic（它多半会在空样本上做无意义的运算），
  // 直接把"没有"说清楚：point/lo/hi 全 null。
  if (n === 0) return { point: null, lo: null, hi: null, ...meta, degenerate: true };

  const point = statistic(values);
  const rng = mulberry32(seed);
  const draws = new Array(resamples);
  for (let r = 0; r < resamples; r += 1) {
    draws[r] = statistic(circularBlockSample(values, meta.block, rng));
  }
  draws.sort((a, b) => a - b);
  const alpha = 1 - level;

  return {
    point,
    lo: percentile(draws, alpha / 2),
    hi: percentile(draws, 1 - alpha / 2),
    ...meta,
    degenerate: n < 2,
  };
}
