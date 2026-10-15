/**
 * 数据体检 —— 输入标准记录数组，输出**问题清单**（纯函数、零依赖、**不修改数据**）。
 *
 * 为什么需要它：**脏数据从不报错**。它只会让 SRI 变成 61.5 而不是 41.2、让社交时差变成 −41 分钟
 * 而不是 +85 分钟 —— 数字格式漂亮，含义却是空的。这个模块的职责就是**把沉默的错误变成可见的话**。
 *
 * 设计：
 *   · 每条问题带 `ruleId` + `severity`（`error` / `warn` / `info`）+ 定位（记录下标 / stage 下标 / 日期）；
 *   · **只报告，不修改** —— 怎么清洗是调用方的事（也符合"库不碰文件系统"的边界）；
 *   · 不做"数据质量评分" —— 那会诱导人盯着一个分数，而不是去看具体哪条记录坏了。
 */
import { dayOf } from './time.js';
import { recordFaults } from './records.js';

/** 短于这个时长的"睡眠段"多半是误录（也可能是真小睡，所以只算 info） */
const PLAUSIBLE_MIN_MINUTES = 30;
/** 长于这个时长不可能是一次睡眠 */
const PLAUSIBLE_MAX_MINUTES = 24 * 60;
/** `dur` 与 `(wake-bed)/60` 的允许偏差（分钟） */
const DUR_TOLERANCE_MINUTES = 5;
/** 卧床时间比实际睡眠长这么多时，给一条 info（多半是入睡难或夜醒多，不是数据错误） */
const LONG_AWAKE_MINUTES = 120;
/** epoch **秒**在 2026 年约 1.8e9；超过 1e11 基本可以断定传成了**毫秒** */
const MILLISECOND_THRESHOLD = 1e11;
/** 本库认识的 stages.state 编码 */
const KNOWN_STATES = new Set([2, 3, 4, 5]);

/**
 * `recordFaults()` 的规则标识 → 人话。见 `records.js` 里那个共享判据。
 * ⚠️ **全部是 `error`**：这些记录 `normalize()` 会直接丢掉 —— 体检若把它们标成 info / warn，
 *    就成了「体检放行、规范化静默丢数据」（2026-10-15 修的正是这个）。
 */
const RECORD_FAULT = {
  'record.not-object': '记录不是对象',
  'record.missing-time': 'bed / wake 不是有效数字',
  'time.bed-not-positive': 'bed 不是正数（本库要 epoch **秒**，且必须是 1970 之后的真实时刻）',
  'time.wake-not-positive': 'wake 不是正数（同上）',
  'time.wake-not-after-bed': 'wake 不晚于 bed',
};

/**
 * 体检出的一条问题。
 * @typedef {object} AuditIssue
 * @property {string} ruleId 规则标识（如 `records.overlap`、`stages.missing-time`）
 * @property {'error'|'warn'|'info'} severity `error` ⇒ 先修数据再算指标
 * @property {string} message 人话描述
 * @property {number} [index] 相关记录下标
 * @property {number} [stageIndex] 相关分段下标
 * @property {string} [ds] 相关自然日（`YYYY-MM-DD`）
 */

/**
 * 体检汇总（**不是"数据质量评分"** —— 那会诱导人盯一个分数，而不是去看哪条坏了）。
 * @typedef {object} AuditSummary
 * @property {number} records 可用的记录条数
 * @property {number} days 覆盖的自然日数
 * @property {number} daysWithoutMainSleep 缺主睡眠的天数
 * @property {{error: number, warn: number, info: number}} bySeverity
 * @property {boolean} ok `false` = 有 `error` 级问题
 */

/**
 * `auditRecords()` 的返回。
 * @typedef {object} AuditResult
 * @property {Array<AuditIssue>} issues 问题清单（按发现顺序）
 * @property {AuditSummary} summary
 */

/**
 * @param {import('./records.js').Record[]} records 标准记录数组（见 records.js 顶部）
 * @param {{tz?: number, minMainMinutes?: number}} [opts]
 * @returns {AuditResult}
 */
export function auditRecords(records, { tz = 8, minMainMinutes = 180 } = {}) {
  const issues = [];
  const push = (ruleId, severity, message, where = {}) => {
    issues.push({
      ruleId, severity, message, ...where,
    });
  };

  if (!Array.isArray(records)) {
    push('input.not-array', 'error', '输入不是数组');
    return { issues, summary: { records: 0, days: 0, daysWithoutMainSleep: 0, bySeverity: { error: 1, warn: 0, info: 0 }, ok: false } };
  }

  const norm = [];
  const seen = new Map();
  const tzSet = new Set();
  /** `stages.no-awake` 用的计数器（见该规则处的注释） */
  let stageRecords = 0;
  let awakeStages = 0;

  records.forEach((r, index) => {
    // ★ 有效性判据与 `normalize()` **共用同一个函数**（`recordFaults`，见 records.js 顶部）。
    //   ⇒ 这里报 error 的记录，那边一定会被丢掉；反过来说，「audit 报 ok」就意味着
    //     `normalize()` 一条都没少收。2026-10-15 之前两边各判一套，于是
    //     `{bed:0,wake:1000}` 被放行（还被误诊成 `dur.too-long`）却被规范化丢弃。
    //   ⇒ 这类记录**不进统计**：days / overlap / no-main-sleep 都不算它，与 normalize 的取舍一致。
    const faults = recordFaults(r);
    if (faults.length) {
      for (const ruleId of faults) push(ruleId, 'error', RECORD_FAULT[ruleId], { index });
      return;
    }
    const bed = Number(r.bed);
    const wake = Number(r.wake);
    if (bed >= MILLISECOND_THRESHOLD || wake >= MILLISECOND_THRESHOLD) {
      push('time.looks-like-milliseconds', 'error', 'bed / wake 像是**毫秒**（本库要 epoch 秒）', { index });
    }

    const derived = (wake - bed) / 60;
    // dur 非数字 / 非正时回退到 derived（下面各有规则报出来）—— 不让 NaN / 负数往下游传播。
    // ⚠️ 判据必须与 `normalize()` 里那一行**逐字一致**，否则又是「体检一种口径、规范化另一种」。
    const givenDur = r.dur === undefined || r.dur === null ? null : Number(r.dur);
    const dur = givenDur !== null && Number.isFinite(givenDur) && givenDur > 0 ? givenDur : Math.round(derived);
    // ⚠️ 关键区分（2026-10-13 实测修正）：`bed..wake` 是**卧床时长**（time in bed），
    //   而 `dur` 多半是**实际睡眠时长**（total sleep time）—— 两者**本来就不该相等**，
    //   差值是"入睡潜伏 + 夜间清醒"。所以只有 `dur` **超过**卧床时长才是真矛盾。
    //   （旧规则把"不相等"一律当错 ⇒ 在本机 121 条数据上误报 37 条；教训见方案 §十二。）
    // `null` 视为「未给」（JSON 里 null 常表示无值），**不能**被当成 0 分钟 —— 那会误报 dur.too-short。
    if (r.dur !== undefined && r.dur !== null) {
      const given = Number(r.dur);
      if (!Number.isFinite(given)) {
        // 非数字必须**报出来**：原来的 `Number.isFinite(Number(r.dur))` 会把整段检查跳过
        // ⇒ `dur: 'abc'` 静默无报（2026-10-13 实测：issues = 0）。
        push('dur.not-a-number', 'warn', `dur=${JSON.stringify(r.dur)} 不是有效数字（本库要分钟数）`, { index });
      } else if (given <= 0) {
        // ★ 独立规则（2026-10-15 修）：原来 `dur: -20` 被当成「短于 30 分钟的小睡」报 info，
        //   于是**数值合法性**的问题被一句「是小睡还是误录？」盖过去了，`ok` 还仍是 true。
        //   负时长不是「短」，是**不可能** —— 它该有自己的名字。
        push('dur.non-positive', 'warn', `dur=${given} 不是正数 —— 已按卧床时长 ${Math.round(derived)} 分钟计算（本库要分钟数，且必须为正）`, { index });
      } else if (given > derived + DUR_TOLERANCE_MINUTES) {
        push('dur.exceeds-time-in-bed', 'warn', `dur=${given} 分钟**超过**卧床时长 ${derived.toFixed(1)} 分钟 —— 两者必有一个不对`, { index });
      } else if (derived - given > LONG_AWAKE_MINUTES) {
        push('dur.much-shorter-than-time-in-bed', 'info', `卧床 ${derived.toFixed(0)} 分钟、实睡 ${given} 分钟（差 ${(derived - given).toFixed(0)}）—— 睡眠效率偏低，**不是**数据错误`, { index });
      }
    }
    if (Number.isFinite(dur) && dur < PLAUSIBLE_MIN_MINUTES) {
      push('dur.too-short', 'info', `单段只有 ${Math.round(dur)} 分钟（短于 ${PLAUSIBLE_MIN_MINUTES}）—— 是小睡还是误录？`, { index });
    }
    if (Number.isFinite(dur) && dur > PLAUSIBLE_MAX_MINUTES) {
      push('dur.too-long', 'warn', `单段 ${Math.round(dur)} 分钟，超过 24 小时`, { index });
    }

    // tz 校验：非数字必须在这一层拦住并报出来 —— 否则下面 `dayOf(wake, 'xx')` 会
    // `new Date(NaN).toISOString()` 抛 RangeError：**体检工具被脏数据搞崩**，
    // 而它正是防脏的最后一道（2026-10-13 实测踩到）。
    let tzUse = tz;
    if (r.tz !== undefined && r.tz !== null) {
      const tzNum = Number(r.tz);
      if (Number.isFinite(tzNum)) {
        tzUse = tzNum;
        tzSet.add(tzNum);
      } else {
        push('tz.not-a-number', 'warn', `tz=${JSON.stringify(r.tz)} 不是有效数字（本库要小时偏移，如 8）—— 已按默认 ${tz} 计算`, { index });
      }
    }

    const key = `${bed}|${wake}`;
    if (seen.has(key)) push('record.duplicate', 'warn', `与第 ${seen.get(key)} 条完全相同`, { index });
    else seen.set(key, index);

    if (r.stages !== undefined && !Array.isArray(r.stages)) {
      push('stages.not-array', 'warn', 'stages 不是数组（会被当成"没有分段"处理）', { index });
    } else if (Array.isArray(r.stages)) {
      stageRecords += 1;
      let prevEnd = -Infinity;
      r.stages.forEach((st, stage) => {
        const s = Number(st?.start);
        const e = Number(st?.end);
        if (!Number.isFinite(s) || !Number.isFinite(e)) {
          push('stages.missing-time', 'error', 'stage 缺 start / end', { index, stage });
          return;
        }
        if (e <= s) push('stages.end-not-after-start', 'warn', 'stage 的 end 不晚于 start', { index, stage });
        if (!KNOWN_STATES.has(Number(st?.state))) {
          push('stages.unknown-state', 'warn', `state=${st?.state} 不在 2/3/4/5 内（本库只认这套编码）`, { index, stage });
        }
        if (Number(st?.state) === 5) awakeStages += 1;
        if (s < prevEnd) push('stages.overlap', 'warn', 'stage 与前一段重叠，或 stages 未按时间排序', { index, stage });
        prevEnd = Math.max(prevEnd, e);
      });
    }

    norm.push({
      index, bed, wake, dur, tz: tzUse, ds: dayOf(wake, tzUse),
    });
  });

  /**
   * ★ `stages.no-awake` —— 这条拦的**不是**「数值非法」，而是「**数值合法、语义可能错位**」。
   *
   * 背景（外部评审 2026-10-14 量化）：`state` 是**厂商私有**的 1–5 编码。别人家用同一区间表示
   * 别的东西时，每一个值都落在合法范围内 ⇒ `stages.unknown-state` **永远抓不到**。
   * SRI 只看「睡着 / 清醒」，所以深睡浅睡换位不要紧；**清醒码错位直接虚高**（实测约 4 分）。
   *
   * 判据**刻意保守**——因为这是一个只能"提示"、不能"断言"的信号：
   *   · 样本要够（≥10 条带分段的记录）：2 晚说明不了任何事；
   *   · 条件：**一个 `state === 5` 都没有**。
   * ⚠️ 触发不代表数据错了：「整夜没醒」是真实存在的。所以措辞必须**同时给出两种解释**，
   *    让人自己去核编码，而不是给一个"你的数据有问题"的判决。
   */
  const NO_AWAKE_MIN_RECORDS = 10;
  if (stageRecords >= NO_AWAKE_MIN_RECORDS && awakeStages === 0) {
    push('stages.no-awake', 'warn',
      `${stageRecords} 条带分段的记录里一个 state=5（清醒）都没有。两种解释都成立：`
      + '① 你确实整夜没醒；② 你的数据源用的不是本库这套编码（本库 awake = 5，源自小米私有编码）。'
      + '若是后者，SRI 会偏高（实测约 4 分）—— 建议先核对编码再读数字。');
  }

  if (tzSet.size > 1) {
    push('tz.mixed', 'warn', `记录里出现 ${tzSet.size} 种 tz（${[...tzSet].join(', ')}）—— 若这是有意的（跨时区旅行）可以忽略`);
  }

  const sorted = [...norm].sort((a, b) => a.bed - b.bed);
  for (let k = 1; k < sorted.length; k += 1) {
    if (sorted[k].bed < sorted[k - 1].wake) {
      push('records.overlap', 'warn', `第 ${sorted[k].index} 条与第 ${sorted[k - 1].index} 条的时段重叠`, { index: sorted[k].index });
    }
  }

  const byDay = new Map();
  for (const r of norm) {
    if (!byDay.has(r.ds)) byDay.set(r.ds, { total: 0, max: 0 });
    const d = byDay.get(r.ds);
    d.total += r.dur;
    d.max = Math.max(d.max, r.dur);
  }
  const noMain = [...byDay.entries()].filter(([, v]) => v.max < minMainMinutes).map(([ds]) => ds).sort();
  if (noMain.length) {
    push(
      'days.no-main-sleep',
      'info',
      `有 ${noMain.length} 天没有 ≥${minMainMinutes} 分钟的主睡眠（只有小睡）：`
      + `${noMain.slice(-5).join(' ')}${noMain.length > 5 ? ' …' : ''}`,
    );
  }

  const bySeverity = { error: 0, warn: 0, info: 0 };
  for (const it of issues) bySeverity[it.severity] += 1;

  return {
    issues,
    summary: {
      records: norm.length,
      days: byDay.size,
      daysWithoutMainSleep: noMain.length,
      bySeverity,
      ok: bySeverity.error === 0 && bySeverity.warn === 0,
    },
  };
}
