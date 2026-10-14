#!/usr/bin/env node
/**
 * Export a standard record array as a **timezone-free** hand-off for cross-checking in R.
 *
 * ⚠️ **Why numbers instead of timestamps.** R's `as.Date(POSIXct)` slices days by `tzone`
 *    (system default — often UTC), while this library slices by the **fixed offset you passed**.
 *    The two defaults differ **silently**, and the only symptom is a one-day shift in *which night a
 *    record belongs to* — which then moves MSFsc and SJL. So: settle the timezone question **once,
 *    locally**, and hand the other side nothing but numbers.
 *
 * ⚠️ **What this file deliberately does NOT do: pick the day boundary for you.** It prints the
 *    aggregate inputs `mctq::msf_sc()` expects, computed exactly the way this library computes them —
 *    so the cross-check answers *"did we implement the published formula correctly?"*, **not**
 *    *"is our whole pipeline right?"*. That is the trade-off (see `ROADMAP.md`, R cross-check entry):
 *    feeding identical aggregates isolates the formula, which is the thing a second implementation can
 *    actually adjudicate.
 *
 * Usage:
 *   node examples/export-for-r.mjs records.json --holidays data/holidays.json [--window 30] [--csv out.csv]
 *
 * ⚠️ Real data never leaves the machine: this writes to stdout / a local file, and nothing else.
 */
import fs from 'node:fs';
import { mainSleep, computePhase, makeRestJudge, minToClock } from '../src/index.js';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const valOf = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const holidaysPath = valOf('holidays', null);
const windowDays = Number(valOf('window', 30));
const csvPath = valOf('csv', null);

if (!file || !holidaysPath) {
  console.error('usage: node examples/export-for-r.mjs <records.json> --holidays data/holidays.json [--window 30] [--csv out.csv]');
  process.exit(2);
}

const records = JSON.parse(fs.readFileSync(file, 'utf8'));
const rest = makeRestJudge(JSON.parse(fs.readFileSync(holidaysPath, 'utf8')));
const main = mainSleep(records);
const p = computePhase(main, rest.isRest, { windowDays });

if (!p || p.insufficient) {
  console.error(`窗口内同时需要工作日与休息日（现在 工作日 ${p?.nW ?? 0} / 休息日 ${p?.nF ?? 0}）⇒ 算不出相位。`);
  process.exit(2);
}

const h = (min) => Number((min / 60).toFixed(6));   // mctq 的惯例单位是**小时**
const rows = [
  ['metric', 'value', 'unit', 'note'],
  ['window_days', p.windowDays, 'days', `from ${p.from} to ${p.to}`],
  ['n_work', p.nW, 'nights', 'work days in window'],
  ['n_free', p.nF, 'nights', 'free days in window'],
  ['so_w', h(p.soW), 'hours_after_midnight', 'circular mean sleep onset, work days'],
  ['so_f', h(p.soF), 'hours_after_midnight', 'circular mean sleep onset, free days'],
  ['sd_w', h(p.sdW), 'hours', 'mean sleep duration, work days'],
  ['sd_f', h(p.sdF), 'hours', 'mean sleep duration, free days'],
  ['sd_week', h(p.sdWeek), 'hours', 'weighted mean over the whole week'],
  ['msw', h(p.msw), 'hours_after_midnight', 'midpoint of work-day sleep'],
  ['msf', h(p.msf), 'hours_after_midnight', 'midpoint of free-day sleep'],
  ['msfsc', h(p.msfsc), 'hours_after_midnight', 'MSF corrected for weekly sleep debt'],
  ['sjl', Number((p.sjl / 60).toFixed(6)), 'hours', 'social jetlag = MSF - MSW'],
  ['alarm_f', 'FALSE', 'logical', 'mctq only; this library always assumes free days are unforced'],
];

const csv = rows.map((r) => r.join(',')).join('\n');
console.log(csv);
if (csvPath) { fs.writeFileSync(csvPath, csv + '\n', 'utf8'); console.error(`\n已写入 ${csvPath}`); }

console.error('\n--- 人在看的版本 ---');
console.error(`窗口 ${p.from} → ${p.to}（${p.windowDays} 天 · 工作日 ${p.nW} / 休息日 ${p.nF}）`);
console.error(`SO_w ${minToClock(p.soW)} · SO_f ${minToClock(p.soF)} · SD_w ${h(p.sdW)}h · SD_f ${h(p.sdF)}h · SD_week ${h(p.sdWeek)}h`);
console.error(`MSW ${minToClock(p.msw)} · MSF ${minToClock(p.msf)} · MSFsc ${minToClock(p.msfsc)} · SJL ${(p.sjl / 60).toFixed(3)}h`);
console.error('\n⚠️ 交给 R 的只有这些**聚合量**（不含任何时间戳）—— 时区问题在本机这一次转换里就settle掉了。');
console.error('⚠️ 因此这次交叉验证回答的是「**发布的公式我们实现对了吗**」，不是「整条管线对不对」—— 这是刻意的取舍。');
console.error('⚠️ 判据先定：**数值不等 ⇒ 先查口径，绝不为对齐改回归锚点**（74.108 / 65.972 / 86.03）。');
console.error('⚠️ `alarm_f`：mctq 规定「自由日靠闹钟醒」时 MSFsc = NA；手环判断不了闹钟 ⇒ 本库恒按自由日算 —— 这是个**已知口径差**，不是 bug。');
