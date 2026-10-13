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
 * @param {Array<object>} records 标准记录数组（见 records.js 顶部）
 * @param {{tz?: number, minMainMinutes?: number}} [opts]
 * @returns {{issues: Array<object>, summary: object}}
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

  records.forEach((r, index) => {
    if (r === null || typeof r !== 'object') {
      push('record.not-object', 'error', '记录不是对象', { index });
      return;
    }
    const bed = Number(r.bed);
    const wake = Number(r.wake);
    if (!Number.isFinite(bed) || !Number.isFinite(wake)) {
      push('record.missing-time', 'error', 'bed / wake 不是有效数字', { index });
      return;
    }
    if (bed >= MILLISECOND_THRESHOLD || wake >= MILLISECOND_THRESHOLD) {
      push('time.looks-like-milliseconds', 'error', 'bed / wake 像是**毫秒**（本库要 epoch 秒）', { index });
    }
    if (wake <= bed) push('time.wake-not-after-bed', 'error', 'wake 不晚于 bed', { index });

    const derived = (wake - bed) / 60;
    // dur 非数字时回退到 derived（下面会报 `dur.not-a-number`）—— 不让 NaN 往下游传播。
    const durRaw = r.dur === undefined || r.dur === null ? Math.round(derived) : Number(r.dur);
    const dur = Number.isFinite(durRaw) ? durRaw : Math.round(derived);
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
        if (s < prevEnd) push('stages.overlap', 'warn', 'stage 与前一段重叠，或 stages 未按时间排序', { index, stage });
        prevEnd = Math.max(prevEnd, e);
      });
    }

    norm.push({
      index, bed, wake, dur, tz: tzUse, ds: dayOf(wake, tzUse),
    });
  });

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
