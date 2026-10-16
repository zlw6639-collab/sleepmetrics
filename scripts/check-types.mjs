/**
 * 类型门 —— 三件事，缺一不可：
 *
 *   ① **非空守卫**（`AGENTS.md` 硬规矩 6）：d.ts 与真实模块都必须"真的有内容"。
 *      一个把 d.ts 读成空串、或把导出数数成 0 的检查，会**静默地全绿** —— 那正是本项目的招牌坑。
 *   ② **导出名对拍**：`sleepmetrics.d.ts` 里声明的**值**导出（`export declare const|function`）
 *      必须与 `src/index.js` 的真实导出**一字不差**（漏声明 ⇒ 使用者拿不到类型；多声明 ⇒
 *      类型承诺了一个运行时不存在的东西）。
 *   ③ **tsc 编译**：`test/types/` 的正向用例必须过；反向用例靠 `@ts-expect-error` **自证**
 *      "类型真的在拦错"（声明一旦退化成 `any`，那些指令就变成 Unused directive ⇒ 变红）。
 *
 * 退出码：**0 = 通过 · 1 = 失败 · 2 = SKIP**（本机没找到 tsc）。
 *   ⚠️ SKIP **不是通过** —— `verify-all.ps1` 按"缺失即 FAIL"处理（与 A9 的 R 交叉同一规矩）。
 *
 * 用法：`node scripts/check-types.mjs`
 * 指定编译器（本机没全局 `tsc` 时用这个）：
 *   `SLEEPMETRICS_TSC=D:\path\to\typescript\bin\tsc node scripts/check-types.mjs`
 *
 * ⚠️ **这不是构建链**（`RELEASE.md` §6）：tsc 只用来**校验手写的** `sleepmetrics.d.ts`，
 *    不生成任何发布物，也不是 `dependencies` 的一部分。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const step = (m) => process.stdout.write(`[types] ${m}\n`);
const fail = (m) => { process.stderr.write(`❌ ${m}\n`); process.exit(1); };

/* ── ① 读声明 + 非空守卫 ── */

const dtsPath = path.join(root, 'sleepmetrics.d.ts');
const dts = fs.readFileSync(dtsPath, 'utf8');
if (dts.length < 3000) fail(`sleepmetrics.d.ts 只有 ${dts.length} 字节 —— 先怀疑尺子（文件截断了？）`);

const declared = [...dts.matchAll(/^export declare (?:const|function) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);

/* ── ② 导出名对拍 ── */

const mod = await import(new URL('../src/index.js', import.meta.url));
const actual = Object.keys(mod);

if (actual.length < 30) fail(`真实模块只暴露了 ${actual.length} 个导出 —— 先怀疑尺子（它没加载起来？）`);
if (declared.length < 30) fail(`d.ts 只声明了 ${declared.length} 个值导出 —— 先怀疑尺子（正则没匹配上？）`);

const missing = actual.filter((n) => !declared.includes(n));
const extra = declared.filter((n) => !actual.includes(n));
if (missing.length || extra.length) {
  if (missing.length) process.stderr.write(`  d.ts 漏声明（运行时存在、类型里没有）：${missing.join(', ')}\n`);
  if (extra.length) process.stderr.write(`  d.ts 多声明（类型承诺了、运行时没有）：${extra.join(', ')}\n`);
  fail(`导出名对拍失败：真实 ${actual.length} 个 · 声明 ${declared.length} 个`);
}
step(`导出名对拍：${actual.length} 个值导出，一字不差`);

/* ── ②b typedef 覆盖：src 里声明的每个 typedef 都必须在 d.ts 里有对应类型 ── */

const typedefs = new Set();
for (const f of fs.readdirSync(path.join(root, 'src')).filter((n) => n.endsWith('.js'))) {
  const txt = fs.readFileSync(path.join(root, 'src', f), 'utf8');
  for (const m of txt.matchAll(/@typedef \{object\} (\w+)/g)) typedefs.add(m[1]);
}
if (typedefs.size < 10) fail(`src/ 里只找到 ${typedefs.size} 个 @typedef —— 先怀疑尺子`);

const declaredTypes = new Set([
  ...[...dts.matchAll(/^export interface (\w+)/gm)].map((m) => m[1]),
  ...[...dts.matchAll(/^export type (\w+)/gm)].map((m) => m[1]),
]);
const uncovered = [...typedefs].filter((n) => !declaredTypes.has(n));
if (uncovered.length) fail(`这些 typedef 没有镜像到 d.ts：${uncovered.join(', ')}`);
step(`typedef 覆盖：${typedefs.size} 个 typedef 全部已在 d.ts 里声明`);

/* ── ③ tsc 编译（找不到就 SKIP —— 不是通过） ── */

const globalRoots = [
  process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules'),
  process.env.HOME && path.join(process.env.HOME, '.npm-global', 'lib', 'node_modules'),
  '/usr/local/lib/node_modules',
  '/usr/lib/node_modules',
].filter(Boolean);

const candidates = [
  process.env.SLEEPMETRICS_TSC,
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  ...globalRoots.map((r) => path.join(r, 'typescript', 'bin', 'tsc')),
].filter(Boolean);

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const tsc = candidates.find(isFile);

if (!tsc) {
  process.stdout.write(
    '[types] SKIP：本机没找到 TypeScript 编译器。\n'
    + '        装它、或指定路径后重跑（这一项**不算通过**）：\n'
    + '          npm i -D typescript            # 或者任意已有的 typescript\n'
    + '          $env:SLEEPMETRICS_TSC = "D:\\path\\to\\typescript\\bin\\tsc"\n',
  );
  process.exit(2);
}

step(`编译器：${tsc}`);
const r = spawnSync(
  process.execPath,
  [tsc, '-p', path.join(root, 'test', 'types', 'tsconfig.json')],
  // ⚠️ `stdio: 'inherit'`：受限环境里 spawn 一个**管道**子进程会 EPERM（见 AGENTS.md）；
  //    输出直接进终端，我们只看退出码。
  { stdio: 'inherit' },
);
if (r.error) fail(`tsc 没跑起来：${r.error.message}`);
if (r.status !== 0) {
  fail(`tsc 退出码 ${r.status} —— 正向用例报错，或反向用例的 @ts-expect-error 变成了"多余指令"`
     + '（后者说明类型变宽了，那些错已经拦不住）');
}
step('✅ 通过：导出名对拍 + typedef 覆盖 + tsc（正向过 / 反向 @ts-expect-error 仍然报错）');
