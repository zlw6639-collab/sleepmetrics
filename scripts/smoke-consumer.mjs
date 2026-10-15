/**
 * 消费者脚本 —— 由 `scripts/pack-smoke.mjs` 复制到临时目录里执行。
 *
 * ⚠️ 它 import 的是 **`'sleepmetrics'`**（从装好的 `node_modules` 解析），不是 `../src/`。
 *    这正是它存在的理由：验证的是**发布物**，不是工作区。
 *
 * ⚠️ **非空守卫**（`AGENTS.md` 硬规矩 6）：先证明"包真的加载进来了"（导出类型 + 版本号），
 *    再谈数值。否则"什么都没跑"会被当成"通过"。
 */
import { createRequire } from 'node:module';
import {
  allSleep, mainSleep, computeSRI, sriLastN, auditRecords, computeIS, computeIV, DISCLAIMER,
} from 'sleepmetrics';

const require = createRequire(import.meta.url);
const pkg = require('sleepmetrics/package.json');

const api = {
  allSleep, mainSleep, computeSRI, sriLastN, auditRecords, computeIS, computeIV,
};
const notFn = Object.entries(api).filter(([, v]) => typeof v !== 'function').map(([k]) => k);
if (notFn.length) {
  console.error('[smoke] 导出缺失或不是函数：', notFn.join(', '));
  process.exit(1);
}
if (typeof DISCLAIMER !== 'string' || DISCLAIMER.length === 0) {
  console.error('[smoke] DISCLAIMER 不是非空字符串');
  process.exit(1);
}
if (!pkg.name || !pkg.version) {
  console.error('[smoke] 读不到 package.json 的 name/version：', pkg);
  process.exit(1);
}
console.log(`[smoke] 发布物 ${pkg.name}@${pkg.version} —— 8 个导出可用，DISCLAIMER 在位`);

// 8 晚完全相同的合成数据 ⇒ SRI 必须**正好** 100
const tz = 8;
const day = (i) => Date.UTC(2026, 2, i) / 1000 - tz * 3600;
const records = Array.from({ length: 8 }, (_, i) => ({
  bed: day(i + 1) + 3600,
  wake: day(i + 1) + 9 * 3600,
  tz,
}));

const all = allSleep(records);
const sri = computeSRI(all);
if (sri.sri !== 100) {
  console.error('[smoke] 8 晚完全相同 ⇒ SRI 应为 100，实得', sri);
  process.exit(1);
}
const audit = auditRecords(records);
if (audit.summary.ok !== true) {
  console.error('[smoke] 干净数据 ⇒ audit 应为 ok:true，实得', audit.summary);
  process.exit(1);
}
console.log(
  `[smoke] audit ok · SRI ${sri.sri}（${sri.days} 天 / ${sri.pairs} 对）· `
  + `sriLastN(7) = ${sriLastN(all, mainSleep(records), 7).sri}`,
);

// 口径断言：IS 必须已中心化 —— 「高基线 + 两天模式完全相反」应为 0（旧实现给 0.99999）
const flipped = computeIS([1000, 1005, 1000, 995, 1000, 995, 1000, 1005], { perDay: 4 }).is;
if (flipped !== 0) {
  console.error('[smoke] IS 未中心化（旧口径）—— 实得', flipped, '，应为 0');
  process.exit(1);
}
console.log(`[smoke] IS 中心化口径已生效（高基线反相 ⇒ ${flipped}）· IV 可调用 ⇒ ${computeIV([1, 2, 3, 4]).iv}`);
