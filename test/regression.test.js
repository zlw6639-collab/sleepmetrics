/**
 * ★ 真实数据回归闸门（设计笔记 §10.4 M0.3 / §十一 第 7·8 条）
 *
 * 规矩：**数值不等 = 抽取过程改坏了语义 —— 先查实现，别改锚点。**
 *
 * 锚点（2026-10-11 口径修正后，基于当时 85 晚主睡眠）：
 *   全量 SRI **74.1** · 近 7 晚 **66.0** · 社交时差 SJL **+86 分钟**
 *
 * 数据不入仓库（§五 红线 1）。本测试通过环境变量取真实数据；
 * 没有数据时**自动跳过**，不会把 CI / 别人的机器搞红。
 *
 *   SLEEPMETRICS_REAL_DATA="E:\ai\mifit\raw\sleep.json" npm run regression
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mifitToRecords } from '../examples/mifit-to-lib.mjs';
import {
  allSleep, mainSleep, computeSRI, sriLastN, computePhase, makeRestJudge,
} from '../src/index.js';

const REAL = process.env.SLEEPMETRICS_REAL_DATA ?? 'E:\\ai\\mifit\\raw\\sleep.json';
const HOLIDAYS_PATH = new URL('../data/holidays.json', import.meta.url);

/** 锚点冻结时刻：2026-10-12 00:00（+08）—— 之后的记录不进这次比对，否则数据增长会把闸门冲掉 */
const FREEZE = Date.parse('2026-10-12T00:00:00+08:00') / 1000;

/**
 * 锚点冻结窗口的**下界**：2026-07-13 00:00（+08）。
 *
 * ⚠️ FREEZE 只挡**未来**，挡不住**补拉过去**（2026-10-14 踩到）：锚点是基于当时「85 晚主睡眠」算的，
 * 而全量 SRI 的口径是「**所有天**」—— 一旦用 `probe --days 365` 把云端历史补回来，
 * 85 天就变成 209 天，锚点被稀释成 74.303 而误报红。
 * 判据：**固定窗口的两项分毫不变**（近 7 晚 65.972 / SJL 86.03）⇒ 是测试的过滤口径有盲点，不是实现坏了。
 * 修法（已实测）：连同下界一起钉住 ⇒ 正好复现 85 天 / 78 对 / 剔除 3 天 / **74.108**。
 * ⇒ 规矩不变：**锚点值一个都不许动，只收紧取数窗口**。
 */
const FROM = Date.parse('2026-07-13T00:00:00+08:00') / 1000;

const ANCHOR = { full: 74.1, last7: 66.0, sjl: 86 };

test('★ 回归闸门：截至 2026-10-11 的真实数据必须复现 74.1 / 66.0 / +86', {
  skip: fs.existsSync(REAL) ? false : `未找到真实数据（可用 SLEEPMETRICS_REAL_DATA 指定）：${REAL}`,
}, () => {
  const raw = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  const records = mifitToRecords(raw).filter((r) => r.wake >= FROM && r.wake < FREEZE);
  const all = allSleep(records);
  const main = mainSleep(records);
  const rest = makeRestJudge(JSON.parse(fs.readFileSync(HOLIDAYS_PATH, 'utf8')));

  const full = computeSRI(all);
  const last7 = sriLastN(all, main, 7);
  const phase = computePhase(main, rest.isRest, { windowDays: 30 });

  const got = {
    full: full.sri,
    last7: last7.sri,
    sjl: phase?.sjl,
  };

  console.log(
    `[regression] 标准记录 ${records.length} 条（主睡眠 ${main.length} 条）· `
    + `全量 SRI ${got.full?.toFixed(3)}（${full.days} 天 / ${full.pairs} 对，剔除 ${full.skipped.length} 天）· `
    + `近 7 晚 ${got.last7?.toFixed(3)} · SJL ${got.sjl?.toFixed(2)} 分钟（窗口 ${phase?.from}~${phase?.to}）`,
  );

  assert.ok(Math.abs(got.full - ANCHOR.full) < 0.05, `全量 SRI = ${got.full}，锚点 ${ANCHOR.full}`);
  assert.ok(Math.abs(got.last7 - ANCHOR.last7) < 0.05, `近 7 晚 SRI = ${got.last7}，锚点 ${ANCHOR.last7}`);
  assert.ok(Math.abs(got.sjl - ANCHOR.sjl) < 0.5, `SJL = ${got.sjl}，锚点 +${ANCHOR.sjl}`);
});

test('回归闸门：旧口径（minDayMinutes=0）应当**算不出**锚点 —— 证明门槛真的在起作用', {
  skip: fs.existsSync(REAL) ? false : '未找到真实数据',
}, () => {
  const raw = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  const records = mifitToRecords(raw).filter((r) => r.wake >= FROM && r.wake < FREEZE);
  const all = allSleep(records);
  const main = mainSleep(records);
  const legacy = sriLastN(all, main, 7, { minDayMinutes: 0 });
  assert.ok(Math.abs(legacy.sri - ANCHOR.last7) > 0.5, `旧口径算出 ${legacy.sri}，本该明显偏离 ${ANCHOR.last7}`);
});
