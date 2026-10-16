/**
 * 就寝热图 —— 一晚一格，一周一行（**纯计算**：不读文件、不打印、不碰网络）。
 *
 * 为什么单独一个文件：**逻辑要能被测试**。`bin/sleepmetrics.js` 是顶层脚本（执行即运行，
 * 不能被 import），把映射与渲染放这里，`test/heatmap.test.js` 才能把规格钉在测试名上 ——
 * 而不是只靠"肉眼看图没毛病"。
 *
 * ⚠️★ **唯一的陷阱：就寝时刻必须按「圆周」映射，不能线性铺到 00:00–24:00。**
 *    23:50 与 00:10 只差 20 分钟，线性刻度会把它们放在标尺的**两端**（一个"极晚"、一个"极早"），
 *    于是图上长出一个不存在的"作息剧变"。所以偏移一律相对**窗口的圆周均值**、用 `circDiff()`
 *    （mctq 的 shorter 口径，取较短路径、带符号）来量：跨午夜相邻的两晚，在这里就是相邻的两格。
 *
 * ⚠️ 本模块只服务**人类可读**路径。`--json` 的键集合是机器契约，不往里加花样（`AGENTS.md` 第 4 条）。
 */
import {
  dailyMain, clockMin, circMean, circDiff, dowOf, minToClock, SEC_PER_DAY,
} from '../src/index.js';

/** 刻度：中心两侧各 90 分钟 —— 超过它的（更早 / 更晚）落进最外档 */
export const SCALE_MINUTES = 90;
/** 中心档的半宽（分钟）—— `±30` 以内都算「就在中心附近」 */
export const CENTER_MINUTES = 30;
/** 五个档位字符（早 → 晚）。用 Latin-1 补充区的书名号，等宽字体里宽度稳定 */
export const LEVEL_CHARS = ['«', '‹', '·', '›', '»'];
/** 没有主睡眠的那一晚 —— 缺的夜晚**必须有自己的字符**，不能与"就寝很准"混为一谈 */
export const MISSING_CHAR = '?';

/**
 * 偏移（分钟，带符号）→ 档位下标（0..4）。
 *
 * 判据**完全对称**：`o ≤ −90` ⇒ 0 · `−90 < o < −30` ⇒ 1 · `−30 ≤ o ≤ 30` ⇒ 2 ·
 * `30 < o < 90` ⇒ 3 · `o ≥ 90` ⇒ 4。所以 `±30` 都落在中心档、`±90` 都落在最外档。
 * @returns {number|null} 非有限数 ⇒ `null`（不猜）
 */
export function levelOf(offset) {
  if (!Number.isFinite(offset)) return null;
  if (offset <= -SCALE_MINUTES) return 0;
  if (offset < -CENTER_MINUTES) return 1;
  if (offset <= CENTER_MINUTES) return 2;
  if (offset < SCALE_MINUTES) return 3;
  return 4;
}

/** 偏移 → 字符 */
export const charOf = (offset) => {
  const lv = levelOf(offset);
  return lv === null ? MISSING_CHAR : LEVEL_CHARS[lv];
};

/** `'YYYY-MM-DD'` → 该日所在周的**周一**（周一 = 一周之首，与列头一致） */
export const mondayOf = (ds) => {
  const d = new Date(`${ds}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - colOf(ds));
  return d.toISOString().slice(0, 10);
};

/** 列序：周一 = 0 … 周日 = 6（库的 `dowOf()` 是 0 = 周日） */
export const colOf = (ds) => (dowOf(ds) + 6) % 7;

/** 列头（与 `colOf` 同一顺序） */
export const COLUMN_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const DAY_MS = SEC_PER_DAY * 1000;
const addDays = (ds, n) => new Date(Date.parse(`${ds}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * 把记录画成「周 × 星期」的格子。
 *
 * 口径：
 *   · 一晚 = **一个醒来日**（`dailyMain()`：每醒来日最长的一段），与 `suggest()` 同一口径；
 *   · `window` 的锚点 = **主睡眠最后一条的 `wake`**（与 `sriLastN()` 同一锚点，别各写一份）；
 *   · 偏移 = `circDiff(该晚就寝时刻, 窗口圆周均值)`，**不是**相对 00:00；
 *   · 窗口内**没有主睡眠**的自然日照样占一格，字符是 `MISSING_CHAR`（缺数据要看得见）。
 *
 * @param {Array<object>} records 标准记录数组
 * @param {{window?: number|null}} [opts] `window` 缺省 / `null` / `0` ⇒ 全量
 * @returns {{center: number|null, rows: Array<{weekLabel: string, cells: Array<object|null>}>,
 *            nights: number, missing: number, from: string|null, to: string|null}}
 *   `cells` 里 `null` = 那一格在窗口之外（不是"缺数据"——缺数据是带 `MISSING_CHAR` 的对象）
 */
export function buildHeatmap(records, opts = {}) {
  const nights = dailyMain(records);
  const anchor = nights.at(-1)?.wake ?? null;
  const win = (opts.window && anchor !== null)
    ? nights.filter((r) => r.wake >= anchor - opts.window * SEC_PER_DAY)
    : nights;

  if (win.length === 0) {
    return { center: null, rows: [], nights: 0, missing: 0, from: null, to: null };
  }

  const beds = win.map((r) => clockMin(r.bed, r.tz));
  // ★ 圆周均值，不是算术平均：23:50 与 00:10 的算术平均是 12:00（本机踩过的老坑）。
  const center = circMean(beds);

  const byDs = new Map();
  win.forEach((r, i) => {
    const prev = byDs.get(r.ds);
    // `dailyMain()` 保证每个醒来日至多一条；真出现重复就保留更长的那段（不静默取第一条）
    if (prev === undefined || r.dur > prev.dur) {
      byDs.set(r.ds, { ds: r.ds, bed: beds[i], dur: r.dur });
    }
  });

  const from = win[0].ds;
  const to = win.at(-1).ds;
  const span = dayDiff(from, to);

  const byWeek = new Map();
  let missing = 0;
  for (let i = 0; i <= span; i += 1) {
    const ds = addDays(from, i);
    const hit = byDs.get(ds);
    const cell = hit
      ? (() => {
        const offset = circDiff(hit.bed, center);
        return { ds, char: charOf(offset), bed: hit.bed, offset };
      })()
      : (missing += 1, { ds, char: MISSING_CHAR, bed: null, offset: null });
    const mon = mondayOf(ds);
    if (!byWeek.has(mon)) byWeek.set(mon, new Array(7).fill(null));
    byWeek.get(mon)[colOf(ds)] = cell;
  }

  const rows = [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekLabel, cells]) => ({ weekLabel, cells }));

  return { center, rows, nights: win.length, missing, from, to };
}

/**
 * 渲染成要打印的行（CLI 只负责 `console.log`）。
 *
 * 图例是**必需**的，不是装饰：图上的字符是相对**圆周均值**的档位，不写出中心与刻度，
 * 读者只能靠自己猜 —— 那正是本项目最反对的「看着像数、其实没说清」。
 * @returns {string[]} 数据不足时返回 `[]`
 */
export function renderHeatmap(hm) {
  if (!hm || hm.nights === 0 || hm.center === null) return [];

  // 行标签固定 10 字符（`YYYY-MM-DD`）+ 1 空格 = 11 显示列；标题与列头都按 11 对齐。
  const INDENT = ' '.repeat(11);
  const lines = [
    `就寝热图   ${hm.nights} 晚 · 中心（圆周均值）${minToClock(hm.center)} · 每格 1 晚 · 刻度 ±${SCALE_MINUTES} 分钟`,
    `${INDENT}${COLUMN_LABELS.map((s) => s.padStart(2)).join(' ')}`,
  ];

  for (const row of hm.rows) {
    const cells = row.cells.map((c) => (c === null ? '  ' : c.char.padStart(2))).join(' ');
    lines.push(`${row.weekLabel} ${cells}`);
  }

  lines.push('');
  lines.push(
    `图例：${LEVEL_CHARS[0]} 早于中心 ≥${SCALE_MINUTES} 分钟 · ${LEVEL_CHARS[1]} 早 ${CENTER_MINUTES}~${SCALE_MINUTES}`
    + ` · ${LEVEL_CHARS[2]} 中心 ±${CENTER_MINUTES} · ${LEVEL_CHARS[3]} 晚 ${CENTER_MINUTES}~${SCALE_MINUTES}`
    + ` · ${LEVEL_CHARS[4]} 晚于中心 ≥${SCALE_MINUTES} · ${MISSING_CHAR} 无主睡眠`,
  );
  lines.push(
    '⚠️ 字符是**相对窗口圆周均值**的偏移（就寝跨午夜，所以必须按圆周量、不能按 00:00–24:00 线性铺）；'
    + '一条直线横着走 = 作息稳定，整行整体左移/右移 = 在漂移。',
  );
  return lines;
}
