/**
 * ★ **合成锚点闸门** —— 不依赖任何真实数据，所以 CI 上**一定真跑**。
 *
 * 为什么需要它（外部评审 2026-10-14 提出）：`test/regression.test.js` 用的是私有真实数据，
 * 在没有它的环境里会 **skip 而 exit 0** ⇒ CI 上的 `npm run regression` 那一步是**假绿**：
 * 它看起来像"闸门通过了"，其实**一次都没执行**。这个库最反对的就是"通过信号本身是假的"。
 *
 * 分工要说清（两者互补，不是替代）：
 *   · `regression.test.js`  —— 钉住**真实数据**上的锚点（74.108 / 65.972 / 86.03）。**真实数据不在仓库里**
 *     ⇒ 它只能在本机跑；CI 上 skip 是**设计**，但必须让人看出来那是 skip、不是 pass。
 *   · 本文件 —— 钉住**合成数据**上整条管线的输出。数据是**确定性生成**的（固定种子），
 *     所以锚点在任何机器上都一样，CI 上能真跑、错了会真红。
 *   ⇒ 它防的是「**未来的改动把数值改了**」（回归测试的本职）；
 *     **不**能防「实现从一开始就错」—— 那是真实数据锚点与手算基准的职责。
 *
 * ⚠️ 锚点值不许"顺手更新"：数值不等 ⇒ **先查实现**，别改锚点（AGENTS.md 硬规矩 1）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSRI, mainSleep, allSleep, computePhase, makeRestJudge,
  computeIS, computeIV,
} from '../src/index.js';

/* ───────── 确定性数据生成（固定种子 ⇒ 任何机器上都是同一份） ───────── */

/** 线性同余伪随机 —— 只为"每次一样"，不用于任何统计性质 */
const lcg = (seed) => {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
};

const TZ = 8;
const DAY = 86400;
/** 2026-03-01 00:00 (+08) */
const T0 = Date.UTC(2026, 2, 1) / 1000 - TZ * 3600;
const dayStart = (i) => T0 + i * DAY;

/**
 * 90 天合成睡眠史：入睡点与时长都带确定性波动；含跨午夜、小睡、以及每 12 天一个
 * 「只剩小睡」的无效天（用来同时压到有效天门槛那条路径）。
 */
function synthNights(nDays = 90) {
  const rnd = lcg(20261014);
  const out = [];
  for (let i = 0; i < nDays; i += 1) {
    const isNapOnlyDay = i % 12 === 5;
    if (isNapOnlyDay) {
      out.push({ bed: dayStart(i) + 14 * 3600, wake: dayStart(i) + 14 * 3600 + 26 * 60, tz: TZ });
      continue;
    }
    const bedMin = 23 * 60 + 30 + Math.round(rnd() * 180);      // 23:30 ~ 02:30
    const durMin = 400 + Math.round(rnd() * 80);                 // 400 ~ 480
    const bed = dayStart(i) + bedMin * 60;
    out.push({ bed, wake: bed + durMin * 60, tz: TZ });
    if (i % 4 === 1) {                                           // 每 4 天一个下午小睡
      out.push({ bed: dayStart(i) + 14 * 3600, wake: dayStart(i) + 14 * 3600 + 35 * 60, tz: TZ });
    }
  }
  return out;
}

/** 90 天等间隔「活动计数」序列（IS/IV 用；与睡眠记录无关，单独合成） */
function synthCounts(days = 90, perDay = 96) {
  const rnd = lcg(777);
  const v = [];
  for (let d = 0; d < days; d += 1) {
    for (let h = 0; h < perDay; h += 1) {
      const hour = (h * 24) / perDay;
      const daytime = hour > 8 && hour < 22 ? 1.6 : 0.4;         // 白天多、夜里少
      v.push(Math.round(rnd() * 30 * daytime));
    }
  }
  return { v, perDay };
}

const NIGHTS = synthNights();
const REST = makeRestJudge({ holidays: [], workdays: [] });      // 只按周末判休息日（合成数据不涉调休）

/* ───────── 先打印实际值（首次取锚点用；写死之后这些 print 可留作诊断） ───────── */

const all = allSleep(NIGHTS);
const main = mainSleep(NIGHTS);
const sri = computeSRI(all);
const phase = computePhase(main, REST.isRest, { windowDays: 90 });
const { v: counts, perDay } = synthCounts();
const isRes = computeIS(counts, { perDay });
const ivRes = computeIV(counts);

console.log('[anchor-synthetic] 生成 %d 天 → 全部段 %d / 主睡眠 %d', 90, all.length, main.length);
console.log('[anchor-synthetic] SRI all-time  = %s（%d 天 / %d 对）', sri.sri, sri.days, sri.pairs);
console.log('[anchor-synthetic] 相位 MSFsc     = %s  SJL = %s 分钟（窗口 %s~%s · 工作日 %d / 休息日 %d）',
  phase?.msfsc, phase?.sjl, phase?.from, phase?.to, phase?.nW, phase?.nF);
console.log('[anchor-synthetic] IS = %s  IV = %s（perDay=%d · %d 天）', isRes?.is, ivRes?.iv, perDay, counts.length / perDay);

/* ───────── 断言（锚点写死） ───────── */

/**
 * 锚点（2026-10-14 首次生成时钉下）。
 * ⚠️ **数值不等 ⇒ 先查实现，别改这里**（与 `regression.test.js` 同一条规矩）。
 * 单位：MSFsc / SJL 是**分钟**（`computePhase` 的单位），IS/IV 无量纲。
 */
const ANCHOR = {
  sriFull: 78.92079579579578,
  sriDays: 82,
  sriPairs: 74,
  msfsc: 274.5463121786038,
  sjl: -2.6241382341286226,
  is: 0.7588305041929926,
  iv: 1.2240608291852815,
};

test('★ 合成锚点闸门：整条管线在确定性合成数据上的输出不许漂移', () => {
  // 非空守卫：被测物先得**真的算出来了**（AGENTS.md 硬规矩 6 —— 空值会让断言假通过）
  assert.ok(Number.isFinite(sri?.sri), 'SRI 不是有限数 —— 先查数据生成与 computeSRI，别改锚点');
  assert.ok(Number.isFinite(phase?.msfsc), 'MSFsc 不是有限数');
  assert.ok(Number.isFinite(isRes?.is) && Number.isFinite(ivRes?.iv), 'IS / IV 不是有限数');

  const near = (got, want, tol, label) => assert.ok(
    Math.abs(got - want) < tol,
    `${label} 漂移了：实得 ${got}，锚点 ${want}（→ 先查实现，别改锚点）`,
  );

  assert.equal(sri.days, ANCHOR.sriDays, 'SRI 有效天数变了');
  assert.equal(sri.pairs, ANCHOR.sriPairs, 'SRI 天对数变了');
  near(sri.sri, ANCHOR.sriFull, 1e-6, '全量 SRI');
  near(phase.msfsc, ANCHOR.msfsc, 1e-6, 'MSFsc');
  near(phase.sjl, ANCHOR.sjl, 1e-6, 'SJL');
  near(isRes.is, ANCHOR.is, 1e-6, 'IS');
  near(ivRes.iv, ANCHOR.iv, 1e-6, 'IV');
});
