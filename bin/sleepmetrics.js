#!/usr/bin/env node
/**
 * sleepmetrics CLI —— **读文件只发生在这里**（设计笔记 §10.2 硬边界 2：库本身不碰文件系统）。
 *
 * 用法：
 *   sleepmetrics sri   <records.json> [--window 7] [--min-day-minutes 180] [--influence] [--json]
 *   sleepmetrics phase <records.json> [--window 30] [--holidays <holidays.json>] [--json]
 *
 * `<records.json>` 必须是**标准记录形状**（见 src/records.js 顶部注释）。
 * 若手上是小米 / Gadgetbridge / Apple Health 的导出，先用 examples/ 里的适配器转一次。
 *
 * 退出码：0 正常；1 参数/读文件出错；2 数据不足（算不出指标）。
 */
import fs from 'node:fs';
import {
  allSleep, mainSleep, computeSRI, sriLastN, sriLeaveOneOut, sriBootstrap, computePhase, makeRestJudge, minToClock,
  dailyMain, circMean, circDiff, clockMin, dayOf, auditRecords,
} from '../src/index.js';
import { buildHeatmap, renderHeatmap } from './heatmap.js';

const USAGE = `sleepmetrics —— 标准睡眠指标（纯 JS，零依赖）

用法：
  sleepmetrics sri   <records.json> [--window N] [--min-day-minutes N] [--influence] [--ci] [--seed N] [--json]
  sleepmetrics phase <records.json> [--window N] [--free-days <表.json>] [--json]
  sleepmetrics audit <records.json> [--json]
  sleepmetrics heatmap <records.json> [--window N]
  sleepmetrics --help ｜ --version

audit 先跑它：脏数据**不会报错**，只会让指标给出看着正常的错数字。

⚠️ 输出的是**研究指标**，不是医疗建议 —— 详见 DISCLAIMER.md。
   （本 CLI 只输出指标与数据体检，不含"建议"类内容。）

--free-days（别名 --holidays）：由你定义「自由日」的那张表 ——
  · 标准办公周 → 周末 + 法定假日（可直接用本包的 data/holidays.json）
  · 倒班 / 夜班 / 无固定周 → 换成你自己的表（例如「夜班后的那天不算自由日」）
  ⚠️ 库不认识日历、也不假设任何人朝九晚五；MSFsc 与社交时差的含义完全取决于这张表。

说明：
  sri    睡眠规律性指数（Phillips 2017）。不加 --window 即全量；--window 7 = 近 7 晚。
  heatmap  就寝热图：一晚一格、一周一行 —— 「作息在漂移吗」一眼可读。
           中心取窗口内的**圆周均值**，字符是相对它的偏移（就寝跨午夜，所以只能按圆周量，
           不能线性铺到 00:00–24:00 —— 否则 23:50 与 00:10 会被画到标尺两端）。
           它只有人类可读输出（--json 不适用）：那是给人看的一张图，不是机器契约。
  phase  睡眠相位与社交时差（Roenneberg）。需要 --holidays 才能区分工作日/休息日。
  --influence  逐日影响度：去掉某一晚之后 SRI 会变成多少。
               小窗口上最有诊断力（近 7 晚时一晚能值 ±11 分，全量 85 天时不到 ±1 分）。
  --ci         SRI 的 bootstrap 置信区间（95%）。单个数字会招来**虚假的精度**，区间把它摆到台面上。
               ⚠️ 重抽样的单位是「**天对**」（相隔 24h 的一对天），**不是 epoch** ——
                  一晚之内的分钟高度自相关，按 epoch 抽会得到**假窄**的区间，看着权威其实骗人。
               ⚠️ 小样本上区间很宽，而**宽就是结论**：近 7 晚时别指望一个窄区间。
               同一种子（--seed）永远给出同一个区间 ⇒ 可复现、可以写进笔记。
               ⚠️ 它**不是**「真值有 95% 概率落在里面」，而是「若把这几晚当作从你的规律性里
                  抽出来的样本，SRI 这个统计量会飘多少」。它与睡眠评分无关。

⚠️ Windows 老控制台（cmd.exe）里中文/符号可能显示为乱码或方框：
   先跑一次 「chcp 65001」 切到 UTF-8，或改用 Windows Terminal / PowerShell 7。
   （Node 恒定输出 UTF-8 字节，是显示端按旧代码页解释才会花 —— 2026-10-13 实测确认。）

⚠️ 记录须是标准形状；本工具不认识任何厂商格式（那属于适配器）。
   SRI 的取值范围是 −100~100（完全规律 = 100 · 与随机无法区分 = 0 · 比随机还糟为负）。
   SRI 与睡眠时长不相关（r=0.05）—— 别拿它当「睡得好不好」的替身。`;

/** 当前小时；可用 SLEEPMETRICS_HOUR 覆盖（藏着的开关，不写进任何文档）。 */
const currentHour = () => {
  const forced = Number(process.env.SLEEPMETRICS_HOUR);
  return Number.isInteger(forced) && forced >= 0 && forced <= 23 ? forced : new Date().getHours();
};

/**
 * `--json` 的**结构版本**。外部评审提出（2026-10-14）：输出里没有版本字段 ⇒ 一旦有人写脚本消费它，
 * 结构改一次就 break 他们一次 —— 而这正是本项目最反对的「**悄悄给错**」。
 *
 * ⇒ 消费方拿到 `schemaVersion` 就能在结构变化时**显式**发现，而不是默默读到不同的字段。
 * ⚠️ 加这个字段**本身也是契约变更**，只是 0.1.1 之前没有任何消费者 ⇒ **此刻加是唯一的零成本时机**。
 * ⚠️ 规矩不变：`--json` 里**不许**出现彩蛋、告示、调试信息 —— 版本号是契约的一部分，不是花样。
 * 变更规则：**增字段**（向后兼容）⇒ 版本号不动，但在 CHANGELOG 里写明；
 *          **改名 / 删字段 / 改语义** ⇒ 版本号 +1。
 */
const SCHEMA_VERSION = 1;

/**
 * 确定性抽样：`(日期 + 数据特征)` 相同 ⇒ 结果永远相同。
 *
 * 为什么需要它：**每次都出现的东西不是彩蛋，是固定输出**。时刻类的旁白（深夜 / 本该睡着）
 * 如果只按"现在几点"触发，使用者天天凌晨跑就会天天撞见 —— 于是它退化成了噪音。
 * 这里用数据特征当种子做 1/N 抽样，于是：① 稀有（约 N 天一次）；② 可复现（同日同数据同结论）；
 * ③ **不需要落盘**（读文件是 CLI 的事，但状态越少越好）。
 */
function pick(seed, oneIn) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % oneIn === 0;
}

/** 界面语言 —— **只影响旁白**（`--json` 永不掺）。可用 SLEEPMETRICS_LANG 覆盖（藏着的开关）。 */
const locale = () => {
  const forced = (process.env.SLEEPMETRICS_LANG || '').toLowerCase();
  if (forced) return forced.startsWith('zh') ? 'zh' : 'en';
  try {
    const l = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
    return l.startsWith('zh') ? 'zh' : 'en';
  } catch { return 'en'; }
};

/**
 * 两个日期串之间的**日历**天数差（纯日历算术，与 tz 无关）。
 * 用途：判断"连续两晚"是否真的**日历相邻** —— 中间缺一天的不能算连上。
 * （2026-10-13 踩过：只比 circDiff、不查日历，会把「09-23 → 09-25」当成连着两晚。）
 */
const calGap = (a, b) => Math.round(
  (Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
    - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000,
);

/** 「同一个枕头时间」的容差（分钟）与需要连续达成的晚数 */
const PILLOW_TOL_MIN = 30;
// N=4 是拿真实数据定的：87 晚里触发 5 次（≈2.4 周一次）。N=3 会到 10 次（≈1.2 周），偏频繁。
const PILLOW_NIGHTS = 4;

/**
 * 「最近 n 晚是不是同一个枕头时间」并「是不是**刚刚**才达成的」。
 *
 * ⚠️ **口径是"全体"，不是"相邻"**（2026-10-13 用真实数据定的）：只比相邻两晚更宽松，但会放过漂移
 *    —— 实测有一段 6 晚，每晚都只跟**前一晚**差 ≤30 分钟，首尾却差了 **151 分钟**，
 *    那已经不是"同一个枕头时间"了。所以要求窗口内**每一晚**都落在**该窗口的圆周均值 ±tol** 内。
 *    **必须用圆周均值**：23:50 与 00:10 只差 20 分钟，线性相减是 1430。
 *
 * ⚠️ **为什么不用"极大连续段"**：全体口径的判定**依赖成员顺序**（均值会随成员移动），
 *    于是"从前往后扫"与"从末尾往回数"会切出**不同的段** ⇒「段长恰好 = n」不是良定义
 *    （实测两套扫描给出的触发次数差了 2 倍以上：5 vs 13）。改成两个**方向无关**的局部问题：
 *      nowOK  = 最近 n 晚全部落在它们的圆周均值 ±tol 内
 *      prevOK = 以**再前一晚**结尾的那 n 晚窗口是否同样成立
 *    触发 = nowOK && !prevOK ⇒ 语义正是"今晚刚达成、昨晚还没有"，一次达成只响一次。
 *
 * @param {Array<{ds: string, bed: number}>} beds 按时间升序的「自然日 + bed 分钟数」
 * @param {number} [tol] 容差（分钟）
 * @param {number} [n] 需要连续的晚数
 * @returns {boolean}
 */
function isFreshPillowStreak(beds, tol = PILLOW_TOL_MIN, n = PILLOW_NIGHTS) {
  const need = beds.slice(-(n + 1)); // 多取一晚，专门用来判断"是不是刚刚才达成"
  if (need.length < n + 1) return false;
  for (let i = 1; i < need.length; i += 1) {
    if (calGap(need[i - 1].ds, need[i].ds) !== 1) return false; // 缺天 ⇒ 不算连续
  }
  const win = (arr) => {
    const m = circMean(arr.map((b) => b.bed));
    return arr.every((b) => circDiff(b.bed, m) <= tol);
  };
  return win(need.slice(-n)) && !win(need.slice(0, n));
}

/**
 * ⚠️ **生理指标键名禁区（2026-10-14 立规矩）** —— 配 `aside()` 顶部的守卫与
 * `test/aside-guard.test.js` 的钉子一起看。给新指标加报告行时**别顺手接 aside**。
 */
const PHYSIO_KEYS = ['hr', 'hrv', 'bpm', 'spo2', 'heart', 'resp', 'breath', 'temp', 'stress', 'rhr'];

/**
 * 旁白文案（中英各一套）。
 * ⚠️ **刻意不含地域梗** —— 梗会让另一半球的人看不懂，把"惊喜"变成"排除"。
 */
const ASIDE_TEXT = {
  en: {
    asleepNow: (hhmm) => `😴 ${hhmm} — by your own recent average, you are asleep right now.`,
    nightOwl: '🌙 night owl detected — the metrics will still be here tomorrow.',
    perfect: '🎯 Perfectly regular. Suspiciously so.',
    samePillow: (n) => `📅 ${n} nights, same pillow time. The SRI knows.`,
    timezones: '🕰  Your week and your weekend are in different timezones.',
    newYear: '🎆 New year, same data. See you on the other side.',
  },
  zh: {
    asleepNow: (hhmm) => `😴 ${hhmm} —— 按你最近的平均，你现在本该睡着了。`,
    nightOwl: '🌙 夜猫子确认 —— 指标明天还在。',
    perfect: '🎯 完全规律。规律得可疑。',
    samePillow: (n) => `📅 连着 ${n} 晚，同一个枕头时间。SRI 知道。`,
    timezones: '🕰  你的工作日和周末，像在两个时区。',
    newYear: '🎆 新的一年，同一份数据。回头见。',
  },
};

/**
 * 旁白：人类可读路径上追加的额外行。见 `AGENTS.md` —— **不要在 README / ROADMAP / 文档里介绍它**。
 *
 * 约束（AGENTS.md 硬规矩 4）：纯本地、零依赖、**不改变任何数值**、**绝不出现在 `--json` 上**，最多两行。
 * 触发依据两类：**数据特征**（优先）与**当前时刻**；时刻类的还要再过一道抽样闸门（见 `pick`）。
 */
function aside(ctx = {}) {
  const { sri, phase, records, freeDay = null, now = new Date() } = ctx;

  // ⚠️⚠️ **生理指标禁区（2026-10-14 立规矩）**：任何**心率 / HRV / 血氧 / 呼吸 / 体温 / 压力**
  // 相关的输出路径**一律不给旁白**（包含趣味文案）。
  // 理由：这类指标上的"趣味解读"极易被读成**医疗暗示**，而这类数据本身最容易引发焦虑 ——
  //      它与「不做医疗建议」是同一条底线的两面。
  // 落地：这里是守卫生效处；`test/aside-guard.test.js` 用「读源码断言调用点」把它钉住
  //      （bin 是顶层执行的 CLI，**无法 import 进测试** —— 见 AGENTS.md 第 6 条）。
  // ⇒ 以后给新指标（如 HRV）加报告行时，**别顺手给它接 aside**。
  const keys = Object.keys(ctx).map((k) => k.toLowerCase());
  if (keys.some((k) => PHYSIO_KEYS.some((p) => k.includes(p)))) return;

  const hour = currentHour();
  const hhmm = `${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const aside = [];

  let bedMean = null;
  let freshPillow = false;
  try {
    // 取 7 晚（> PILLOW_NIGHTS）—— 多留几晚，好让"更早也成立"这件事看得出来。
    const recent = dailyMain(records, 180, 8).slice(-7);
    const beds = recent.map((r) => ({ ds: dayOf(r.wake, r.tz ?? 8), bed: clockMin(r.bed, r.tz ?? 8) }));
    bedMean = beds.length ? circMean(beds.map((b) => b.bed)) : null;
    freshPillow = isFreshPillowStreak(beds);
  } catch { /* 旁白出错绝不能影响主输出 */ }

  const nowMin = hour * 60 + now.getMinutes();
  // 种子只取「日期 + 他自己的数据特征」—— 不含小时：同一天无论几点跑，结论一致，不会反复出现
  const seed = `${md}|${Math.round(bedMean ?? -1)}|${Math.round(sri ?? -1)}|${freeDay === null ? '?' : (freeDay ? 'F' : 'W')}`;

  const T = ASIDE_TEXT[locale()];
  if (bedMean !== null && Math.abs(circDiff(nowMin, bedMean)) <= 30 && pick(seed, 3)) {
    aside.push(T.asleepNow(hhmm));
  } else if (hour < 5 && pick(seed, 7)) {
    aside.push(T.nightOwl);
  }
  if (typeof sri === 'number' && sri >= 99.95) {
    aside.push(T.perfect);
  }
  // 「连着 N 晚同一个枕头时间」—— **数据驱动**型，按 AGENTS.md 的规矩**不叠 pick 抽样**。
  // ★ 它靠**状态变化**保证稀有：只在段长**恰好 = N** 的那一晚出现（= 刚刚达成那一刻）。
  //   所以段继续变长的那些晚都不响 ⇒ 一次达成只响一次；同一份数据永远同一结论；
  //   不需要随机、也不需要落盘记状态（"一晚最多一次"那类记性，这里用数据本身代替）。
  if (freshPillow) {
    aside.push(T.samePillow(PILLOW_NIGHTS));
  }
  if (phase && !phase.insufficient && Math.abs(phase.sjl) >= 120) {
    aside.push(T.timezones);
  }
  if (md === '12-31' || md === '01-01') {
    aside.push(T.newYear);
  }

  if (aside.length) console.log('\n' + aside.slice(0, 2).join('\n'));
}

function parseArgs(argv) {
  const out = {
    cmd: argv[0], file: null, window: null, minDayMinutes: 180, holidays: null, json: false, influence: false,
    ci: false, seed: null,
    errors: [],
  };
  const rest = argv.slice(1);

  /**
   * 读一个**必须是数字**的选项值。
   *
   * ⚠️ 非法值必须**报错**，不许静默退回默认值 —— 2026-10-13 外部评审实测：
   *    `--window abc` 让 `Number()` 得到 NaN，而 **NaN 是 falsy** ⇒ 静默退化成「全量」，
   *    用户以为在看近 7 晚、实际拿到全量 85 天（两个数差 8 分）。这正是本库最反对的「悄悄给错」。
   */
  const numOpt = (name, i, { min = 0, integer = false } = {}) => {
    const raw = rest[i + 1];
    if (raw === undefined || raw.startsWith('--')) {
      out.errors.push(`${name} 缺少值`);
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) out.errors.push(`${name} 的值 ${JSON.stringify(raw)} 不是数字`);
    else if (integer && !Number.isInteger(n)) out.errors.push(`${name} 的值 ${raw} 必须是整数`);
    else if (n < min) out.errors.push(`${name} 的值 ${raw} 不能小于 ${min}`);
    else return n;
    return null;
  };

  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--json') out.json = true;
    else if (a === '--influence') out.influence = true;
    else if (a === '--ci') out.ci = true;
    else if (a === '--seed') {
      const v = numOpt('--seed', i, { min: 0, integer: true });
      if (v !== null) out.seed = v;
      i += 1;
    } else if (a === '--window') {
      out.window = numOpt('--window', i, { min: 0, integer: true });
      i += 1;
    } else if (a === '--min-day-minutes') {
      const v = numOpt('--min-day-minutes', i, { min: 0, integer: true });
      if (v !== null) out.minDayMinutes = v;
      i += 1;
    } else if (a === '--holidays' || a === '--free-days') {
      const raw = rest[i + 1];
      if (raw === undefined || raw.startsWith('--')) out.errors.push(`${a} 缺少值`);
      else { out.holidays = raw; i += 1; }
    } else if (a.startsWith('-')) out.errors.push(`未知选项 ${a}`);
    else if (out.file === null) out.file = a;
  }
  // `--seed` 只对 `--ci` 有意义 ⇒ 单独给它等于**什么都没发生**，必须报出来。
  // （本库不给"悄悄无效的参数"发通行证：静默忽略会让写脚本的人以为自己换了种子。）
  if (out.seed !== null && !out.ci) out.errors.push('--seed 只与 --ci 一起用（否则它不影响任何输出）');
  return out;
}

/**
 * 读 JSON 文件 —— **顺手去掉 UTF-8 BOM**。
 *
 * 外部评审实测（2026-10-14）：Windows 上的常见写文件方式（记事本、Excel 导出、
 * PowerShell 的 `Set-Content -Encoding UTF8`）**会写入 BOM**，而 `JSON.parse` 遇到它直接抛
 * `Unexpected token '\uFEFF'` —— 症状看起来像「文件坏了」，其实只是多了一个编码前缀。
 *
 * ⚠️ 只在这一层去 BOM：**库本体不收文件，也就没有 BOM 问题**（`NON-GOALS.md` §4）。
 * 这正是「读文件只允许发生在 bin/」那条边界带来的好处。
 */
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

const args = parseArgs(process.argv.slice(2));

// `--help` / `-h` / `--version` / `-v` 是**用户主动要的**，按惯例退出码 0 —— 它们不是错误。
// （2026-10-13 外部评审实测：这三个原先都返回 1，会被 CI / 脚本误判成失败。）
if (['--version', '-v'].includes(args.cmd)) {
  // 版本号**只从 package.json 读** —— 硬编码两处迟早漂移（"同一件事只写一处"）
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}
if (['--help', '-h', 'help'].includes(args.cmd) || !args.cmd) {
  console.log(USAGE);
  process.exit(0);
}
// 参数错误**先于一切**报出来（`--help` 除外，见上）—— 理由见 parseArgs 里 numOpt 的注释。
// 关键是**不要用默认值继续跑**：那会让 `--window abc` 悄悄变成"全量"。
if (args.errors.length) {
  for (const e of args.errors) console.error(`[sleepmetrics] 参数错误：${e}`);
  console.error('[sleepmetrics] 已停止（**不会**用默认值继续算）—— 用 --help 看用法。');
  process.exit(1);
}
if (!args.file || !['sri', 'phase', 'audit', 'heatmap'].includes(args.cmd)) {
  console.log(USAGE);
  process.exit(1);
}

let records;
try {
  records = readJson(args.file);
} catch (e) {
  console.error(`[sleepmetrics] 读不了记录文件：${e.message}`);
  process.exit(1);
}
if (!Array.isArray(records) || records.length === 0) {
  console.error('[sleepmetrics] 记录文件应当是**非空数组**（标准记录形状）');
  process.exit(1);
}

const all = allSleep(records);
const main = mainSleep(records);

/**
 * 「今天算不算自由日」—— **只在调用方给了节假日表时才算**。
 * 表是使用者提供的 ⇒ CLI 不假设「朝九晚五 + 周末」（倒班的人可以给一张自己的表）。
 * 没有表就是 `null`，旁白种子记成 `?`，绝不硬塞日历假设。
 */
let todayIsFree = null;
if (args.holidays) {
  try {
    const t = new Date();
    const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    todayIsFree = makeRestJudge(JSON.parse(fs.readFileSync(args.holidays, 'utf8'))).isRest(ds);
  } catch { todayIsFree = null; }
}

if (args.cmd === 'audit') {
  const r = auditRecords(records);
  const { summary, issues } = r;
  if (args.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...r }, null, 2));
  } else {
    console.log(`数据体检   ${summary.records} 条记录 · ${summary.days} 天 · error ${summary.bySeverity.error} · warn ${summary.bySeverity.warn} · info ${summary.bySeverity.info}`);
    if (issues.length === 0) {
      console.log('✅ 没发现问题');
    } else {
      const order = { error: 0, warn: 1, info: 2 };
      const icon = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' };
      const sorted = [...issues].sort((x, y) => order[x.severity] - order[y.severity]);
      for (const it of sorted.slice(0, 15)) {
        const where = it.index !== undefined ? ` #${it.index}` : '';
        console.log(`${icon[it.severity]}[${it.severity}] ${it.ruleId}${where} — ${it.message}`);
      }
      if (sorted.length > 15) console.log(`… 另有 ${sorted.length - 15} 条（--json 看全部）`);
    }
    console.log(summary.bySeverity.error > 0
      ? '结论：**有 error** —— 先修数据再算指标，否则数字不可信。'
      : (summary.bySeverity.warn > 0 ? '结论：能算，但有 warn 值得看一眼。' : '结论：数据可用。'));
  }
  if (summary.bySeverity.error > 0) process.exit(1);
} else if (args.cmd === 'heatmap') {
  // ⚠️ 热图**只走人类可读路径**（`AGENTS.md` 硬规矩 4：`--json` 的键集合是机器契约）。
  //    而且是**可见的**拒绝，不是静默忽略 —— 静默会让写脚本的人以为自己拿到了 JSON。
  if (args.json) {
    console.error('[sleepmetrics] heatmap 只有人类可读输出：--json 的键集合是机器契约，'
      + '不往里加花样（它就是给人看的一张图）。');
    process.exit(1);
  }
  const hm = buildHeatmap(records, { window: args.window });
  if (hm.nights === 0 || hm.center === null) {
    console.error('[sleepmetrics] 数据不足：窗口内没有主睡眠记录（>180 分钟），画不出就寝热图');
    process.exit(2);
  }
  for (const line of renderHeatmap(hm)) console.log(line);
} else if (args.cmd === 'sri') {
  const r = args.window ? sriLastN(all, main, args.window, { minDayMinutes: args.minDayMinutes })
    : computeSRI(all, { minDayMinutes: args.minDayMinutes });
  if (r.sri === null) {
    console.error('[sleepmetrics] 数据不足：没有任何「相邻且有效」的天对，算不出 SRI');
    process.exit(2);
  }
  const loo = args.influence
    ? sriLeaveOneOut(all, main, args.window, { minDayMinutes: args.minDayMinutes })
    : null;
  // ⚠️ bootstrap 与上面的 `r` **共用同一个窗口口径**（`sriBootstrap` 内部用的是同一个
  //    `windowSlice()`）—— 所以 `ci.pairs` 必然等于 `r.pairs`，不是"另算了一份"。
  const ci = args.ci
    ? sriBootstrap(all, main, args.window, {
      minDayMinutes: args.minDayMinutes,
      ...(args.seed === null ? {} : { seed: args.seed }),
    })
    : null;
  if (args.json) {
    // ⚠️ `--json` 是机器契约：**不带 --influence / --ci 时顶层输出一字不变**。
    //    两个可选块只在调用方**显式要求**时才出现 —— 不是偷偷塞进去的花样。
    const base = { schemaVersion: SCHEMA_VERSION, ...r, window: args.window ?? null, minDayMinutes: args.minDayMinutes };
    const extra = {};
    if (loo) extra.influence = loo.out;
    if (ci) {
      // 只放**区间自己的**字段：sri/days/pairs/... 顶层已经有了，重复一遍就是两个来源。
      extra.interval = {
        lo: ci.lo,
        hi: ci.hi,
        level: ci.level,
        unit: ci.unit,
        resamples: ci.resamples,
        block: ci.block,
        seed: ci.seed,
        degenerate: ci.degenerate,
      };
    }
    console.log(JSON.stringify(Object.keys(extra).length ? { ...base, ...extra } : base, null, 2));
  } else {
    console.log(`SRI            ${r.sri.toFixed(1)}   （取值范围 −100~100：完全规律 = 100、与随机无法区分 = 0、比随机还糟为负；与睡眠时长不相关）`);
    console.log(`窗口           ${r.from} ~ ${r.to}${args.window ? `（近 ${args.window} 晚）` : '（全量）'}`);
    console.log(`有效天 / 天对  ${r.days} 天 / ${r.pairs} 对`);
    if (r.skipped.length) console.log(`已剔除的天     ${r.skipped.join(' ')}（当天睡着 < ${args.minDayMinutes} 分钟）`);

    if (ci) {
      const pct = Math.round(ci.level * 100);
      if (ci.degenerate) {
        console.log(`${pct}% 区间       ${ci.lo.toFixed(1)} ~ ${ci.hi.toFixed(1)}   ⚠️ **退化**：只有 ${ci.pairs} 个天对，宽度估不出来 —— 别把这个宽度读成「很确定」`);
      } else {
        console.log(`${pct}% 区间       ${ci.lo.toFixed(1)} ~ ${ci.hi.toFixed(1)}   ← bootstrap，重抽样单位 =「天对」；小样本上很宽，而**宽就是结论**`);
      }
    }

    if (loo) {
      // 按 |Δ| 排序 —— 最该看的是"去掉它变化最大"的那几晚，不是日期顺序。
      const sorted = [...loo.out].sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));
      console.log('\n逐日影响度    去掉某一晚之后的 SRI（Δ 为正 = 去掉它反而升 ⇒ 它在拖后腿）');
      const show = sorted.slice(0, 8);
      for (const o of show) {
        const d = o.delta === null ? '  —' : `${o.delta >= 0 ? '+' : ''}${o.delta.toFixed(1)}`;
        const tag = o.isolated
          ? '   ← 孤立：没有相邻的日历天，本就不参与配对（Δ=0 不代表它规律）' : '';
        console.log(`  Δ ${d.padStart(5)}   ${o.date} → ${o.sri === null ? 'null' : o.sri.toFixed(1)}${tag}`);
      }
      if (sorted.length > show.length) console.log(`  … 另 ${sorted.length - show.length} 天（用 --json 看全部）`);
    }
    aside({ sri: r.sri, records, freeDay: todayIsFree });
  }
} else {
  if (!args.holidays) {
    console.error('[sleepmetrics] phase 需要 --holidays <holidays.json>（库不认识日历，表要外部提供）');
    process.exit(1);
  }
  let table;
  try {
    table = readJson(args.holidays);
  } catch (e) {
    console.error(`[sleepmetrics] 读不了节假日表：${e.message}`);
    process.exit(1);
  }
  const rest = makeRestJudge(table);
  const p = computePhase(main, rest.isRest, { windowDays: args.window ?? 30 });
  if (!p || p.insufficient) {
    console.error(`[sleepmetrics] 数据不足：窗口内需要同时有工作日与休息日（工作日 ${p?.nW ?? 0} / 休息日 ${p?.nF ?? 0}）`);
    process.exit(2);
  }
  if (args.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...p }, null, 2));
  } else {
    console.log(`MSW  （工作日睡眠中点）  ${minToClock(p.msw)}`);
    console.log(`MSF  （休息日睡眠中点）  ${minToClock(p.msf)}`);
    console.log(`MSFsc（校正后）          ${minToClock(p.msfsc)}`);
    console.log(`SJL  （社交时差）        ${p.sjl.toFixed(0)} 分钟${p.sjl > 0 ? '（休息日更晚）' : ''}`);
    console.log(`窗口                     ${p.from} ~ ${p.to}（${p.windowDays} 天：工作日 ${p.nW} / 休息日 ${p.nF}）`);
    // ⚠️ 窗口**两端**都要丢进去：只查起始年的话，跨年窗口（如 2026-12-20 ~ 2027-01-19）
    //    后半段其实已经退化成「只按周末」，却一句提示都没有 —— 正是本库最反对的「悄悄给错」。
    const missing = rest.missingYears([p.from, p.to]);
    if (missing.length) console.log(`⚠️ 缺 ${missing.join('/')} 年的调休数据 ⇒ 已退化为「只按周末」`);

    // 口径体检：这张表**对这个人**合理吗？自由日占比太离谱的话，数字再漂亮也没有意义。
    // 刻意做成"数据驱动"而不是每次都唠叨一句提示 —— 只在真的可能被误用时才开口。
    const [fy, fm, fd] = p.from.split('-').map(Number);
    const [ty, tm, td] = p.to.split('-').map(Number);
    let totalDays = 0;
    let freeDays = 0;
    for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86400000) {
      const ds = new Date(t).toISOString().slice(0, 10);
      totalDays += 1;
      if (rest.isRest(ds)) freeDays += 1;
    }
    const freeRatio = totalDays ? freeDays / totalDays : 0;
    if (totalDays >= 14 && (freeRatio < 0.1 || freeRatio > 0.5)) {
      console.log(`⚠️ 口径体检：这张表把窗口内 ${totalDays} 天里的 ${freeDays} 天算作「自由日」（${Math.round(freeRatio * 100)}%）`);
      console.log('   若与你的实际作息不符（倒班 / 夜班 / 无固定周），请用 --free-days 换上你自己的表 ——');
      console.log('   MSFsc 与社交时差的含义完全取决于「自由日」是怎么定义的。');
    }
    aside({ phase: p, records, freeDay: todayIsFree });
  }
}
