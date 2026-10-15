/**
 * 逐个跑**所有**测试文件并聚合结果。
 *
 * 为什么不用 `npm test` 里那串 `&&`：**第一个失败的文件会让后面的一律不执行**。
 * 2026-10-15 实测踩到 —— 一次跑出 "92 pass / 1 fail"，其实 `anchor-synthetic` 与 `regression`
 * **从未运行**：锚点"看起来没问题"，只是因为**没人检查它们**。
 * ⇒ 验证工具本身也会骗人，这跟 `AGENTS.md` 硬规矩 6 是同一个家族。
 *
 * 附带好处：**自动发现** `test/*.test.js`，新文件不会变成"孤儿"（只在本地手跑、CI 里不存在）。
 *
 * ⚠️ 子进程用 `stdio: 'inherit'`，**不用默认的 `'pipe'`**：受限环境里 spawn 一个管道子进程会
 *   `EPERM`。inherit 让每个文件直接写终端，我们只看退出码。
 *
 * 用法：`npm test` 或 `node scripts/test-all.mjs`
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const testDir = fileURLToPath(new URL('../test/', import.meta.url));
const files = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js')).sort();

const failed = [];
const t0 = Date.now();
for (const f of files) {
  process.stdout.write(`\n=== ${f} ===\n`);
  const r = spawnSync(process.execPath, [path.join(testDir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
process.stdout.write(`\n=== ${files.length} 个测试文件 · 失败 ${failed.length} 个 · ${secs}s ===\n`);
if (failed.length) {
  process.stdout.write(`失败：${failed.join(', ')}\n`);
  process.exit(1);
}
