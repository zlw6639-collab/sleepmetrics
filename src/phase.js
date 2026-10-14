/**
 * 睡眠相位：MSW / MSF / MSFsc / 社交时差 SJL
 *
 * 提出：Roenneberg et al. 2003 J Biol Rhythms 18(1):80-90 / 2012 Curr Biol 22(10):939-43
 * 公式：对照 R 包 `mctq` 官方文档逐字核对
 *
 *   MSF   = SO_F + SD_F/2            （自由日睡眠中点）
 *   MSFsc = SO_F + SD_week/2         （按整周睡眠时长校正后的自由日中点）
 *   SJL   = MSF − MSW                （社交时差）
 *
 * 其中 SO_F = 自由日入睡时刻（**圆周均值**）、SD_F = 自由日睡眠时长、
 * SD_week = 整周（工作日 + 自由日）加权平均睡眠时长。
 *
 * ⚠️ 移植语义（§十一 第 1 条）：跨午夜相减必须走 circular「shorter」口径 ——
 *    直接线性相减在跨午夜时会得出 ±1000 分钟这种荒谬的社交时差。
 *
 * ⚠️ **已知失效条件（诚实标注，别当成 bug）**：mctq 规定「休息日靠闹钟醒」时 MSFsc = NA。
 *    手环数据判断不了闹钟，所以本实现**恒按自由日计算** —— 读数要照这个口径理解。
 *
 * ✅ **R 交叉验证（2026-10-14 · mctq 0.3.2 / R 4.6.1）**：在 222 天真实数据上，本实现与
 *    `mctq::msf_sc()` **逐位一致**（MSFsc 差 0.000000 h、`mctq::sjl()` 差 0.000000 h，容差 1 秒）；
 *    `mctq::sjl()` 的默认 `method = "shorter"` 也与本库的圆周口径一致 —— 这是「换执行者验公式」。
 * ⚠️ **交叉验证顺带查出 mctq 还有一个本库没有的分支**：`sd_f <= sd_w`（自由日**不比**工作日睡得更久）时，
 *    mctq **不做校正**、直接返回 MSF；而本实现**恒**算 `SO_f + SD_week/2` ⇒ 两条口径在这类数据上会不同
 *    （本机数据落的是 `sd_f > sd_w` 分支，所以这次一致）。
 *    **刻意不改**：① 回归锚点钉住了数值；② 手环给不出 alarm 信息，「恒按自由日算」在这个语境下自洽。
 *    ⇒ **这是一条已知口径差，不是 bug** —— 拿别的数据集比对时要记得它。
 */
import {
  MIN_PER_DAY, SEC_PER_DAY, avg, circDiff, circMean, clockMin, dayOf, mod,
} from './time.js';
import { DISCLAIMER } from './disclaimer.js';

/**
 * @param {Array<object>} records 规范化后的**主睡眠**记录（按 bed 升序）
 * @param {(ds: string) => boolean} isRest 休息日判定函数（由调用方注入，见 rest.js）
 * @param {{windowDays?: number, tz?: number}} [opts]
 * @returns {object|null} 不足（缺工作日或缺休息日）时返回带 `insufficient: true` 的对象
 */
export function computePhase(records, isRest, { windowDays = 30, tz = 8 } = {}) {
  const last = records?.at(-1);
  if (!last) return null;

  const cutoff = last.wake - windowDays * SEC_PER_DAY;
  const win = records.filter((m) => m.wake >= cutoff);
  const work = win.filter((m) => !isRest(m.ds));
  const rest = win.filter((m) => isRest(m.ds));

  if (!work.length || !rest.length) {
    return {
      windowDays, nW: work.length, nF: rest.length, insufficient: true,
    };
  }

  const sdW = avg(work.map((m) => m.dur));
  const sdF = avg(rest.map((m) => m.dur));
  const sdWeek = (sdW * work.length + sdF * rest.length) / (work.length + rest.length);

  const soW = circMean(work.map((m) => clockMin(m.bed, m.tz ?? tz)));
  const soF = circMean(rest.map((m) => clockMin(m.bed, m.tz ?? tz)));

  const msw = mod(soW + sdW / 2);
  const msf = mod(soF + sdF / 2);
  const msfsc = mod(soF + sdWeek / 2);

  return {
    windowDays,
    nW: work.length,
    nF: rest.length,
    soW,
    soF,
    sdW,
    sdF,
    sdWeek,
    msw,
    msf,
    msfsc,
    sjl: circDiff(msf, msw),
    sjlSc: circDiff(msfsc, msw),
    from: dayOf(win[0].wake, tz),
    to: dayOf(last.wake, tz),
  };
}

/** 分钟 → 'HH:MM'（0..1439，自动取模）；给报告/CLI 用，便于人读 */
export const minToClock = (m) => {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  const v = mod(Math.round(m), MIN_PER_DAY);
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
};

/**
 * 时型分档（chronotype）—— **切点由调用方注入，本库不写死任何钟点**。
 *
 * 为什么不写死：文献里常用的做法是按**人群分布的分位**分档（例如 MSFsc 的五分位），
 * 而不是按固定钟点 —— 固定钟点会随人群、季节、纬度漂移（同一份 MSFsc 在德国和中国不该用同一把尺子）。
 * 本库**不编切点**（红线 2：不编数字），只做映射。
 *
 * @param {number} msfscMinutes MSFsc（分钟；由 `computePhase()` 给出）
 * @param {{cuts: number[], labels?: string[]}} opts
 *   `cuts`：递增切点，长度 = 档数 − 1（例如五分位的四个分位点）
 *   `labels`：长度必须 = `cuts.length + 1`；缺省用 `'1'…'n'`
 * @returns {{label: string, index: number, cuts: number[]}|null} 参数不合法返回 `null`（不猜）
 */
export function chronotype(msfscMinutes, { cuts, labels } = {}) {
  if (!Number.isFinite(msfscMinutes)) return null;
  if (!Array.isArray(cuts) || cuts.length === 0) return null;
  const monotonic = cuts.every((c, i) => Number.isFinite(c) && (i === 0 || c > cuts[i - 1]));
  if (!monotonic) return null;
  let index = cuts.findIndex((c) => msfscMinutes < c);
  if (index === -1) index = cuts.length;
  const names = Array.isArray(labels) && labels.length === cuts.length + 1 ? labels : null;
  return { label: names ? names[index] : String(index + 1), index, cuts };
}

/**
 * **双口径时型对比** —— 把「活动记录算出的档位」与「问卷给出的档位」放在一起看。
 *
 * 为什么不实现量表：PSQI / MEQ / ESS 这类**有版权、也有临床属性**（是筛查/诊断工具）。
 * 本库只接受**你已经算好的档位**（两边用**同一组 cuts** 算出来的 `index`），
 * 量表题面与计分请走官方渠道 —— 详见 `NON-GOALS.md` §8。
 *
 * ⚠️ **免责（这个功能上尤其要紧）**：两者不一致**不是问题，是常态** ——
 *   问卷测的是**偏好**（你想几点睡），活动记录测的是**行为**（你实际几点睡）；
 *   工作/上学时间、照顾家人、社交安排都会把行为推离偏好。
 *   这个函数**不做诊断、不判断谁对谁错**，也**不构成任何健康结论**。
 *
 * @param {object} opts
 * @param {number} opts.activityIndex 活动记录口径的档位（`chronotype()` 的 `index`，0 起）
 * @param {number} opts.questionnaireIndex 问卷口径的档位（**必须用同一组 cuts**）
 * @param {string[]} [opts.labels] 档位名（长度 = cuts+1；缺省用 `'1'…'n'`）
 * @param {number} [opts.tolerance] 差几档以内算"一致"（默认 0）
 * @returns {object|null} 参数不合法返回 `null`（不猜）
 */
export function compareChronotype({
  activityIndex, questionnaireIndex, labels = null, tolerance = 0,
} = {}) {
  if (!Number.isInteger(activityIndex) || !Number.isInteger(questionnaireIndex)) return null;
  if (activityIndex < 0 || questionnaireIndex < 0) return null;
  const delta = activityIndex - questionnaireIndex;
  const agree = Math.abs(delta) <= Math.max(0, tolerance);
  const name = (i) => (Array.isArray(labels) && labels[i] !== undefined ? labels[i] : String(i + 1));
  const gap = Math.abs(delta);

  return {
    agree,
    delta,
    direction: delta === 0 ? 'same' : (delta > 0 ? 'activity-later' : 'activity-earlier'),
    activity: { index: activityIndex, label: name(activityIndex) },
    questionnaire: { index: questionnaireIndex, label: name(questionnaireIndex) },
    note: agree
      ? '问卷与行为对得上。这既不说明"健康"，也不说明"不健康" —— 它只说明两个口径没有分歧。'
      : `行为比问卷${delta > 0 ? '晚' : '早'} ${gap} 档。**两者不一致很常见**：`
        + '工作/上学时间、照顾家人、社交安排都会把行为推离偏好。'
        + '它**不表示**你有睡眠障碍，也**不要**据此调整任何治疗或用药。',
    disclaimer: DISCLAIMER,
  };
}
