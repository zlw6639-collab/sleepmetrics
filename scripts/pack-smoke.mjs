/**
 * 打包安装 smoke test —— 验证**发布物**（而不是工作区）真的能装、能 import、能算。
 *
 * 为什么需要它：`verify-all.ps1` 的 A5 只检查 tarball 的**文件名清单**，它不 import 任何东西。
 * 而"文件都在、一 import 就崩"（`exports` 映射写错、漏了 `src/` 里被 import 的模块、用了
 * 新版才认的语法）只有**真装一次**才知道。
 *
 * 用法：`npm run smoke`
 *
 * ⚠️ 子进程一律 `stdio: 'inherit'`，**不用默认的 `'pipe'`**：受限环境里 spawn 一个管道子进程
 *   会 `EPERM`（沙箱边界，见 `AGENTS.md`）。也正因为拿不到 stdout，tarball 文件名靠**扫目录**
 *   得到，不靠解析 npm 的输出 —— 解析输出正是本项目踩过的坑（空输出让断言假通过）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sleepmetrics-smoke-'));
const step = (m) => process.stdout.write(`[smoke] ${m}\n`);

/** 路径含空格会让下面 `cmd.exe` 那一步的拼接出岔子 —— 宁可明确失败，也不静默装错东西 */
if (/\s/.test(work) || /\s/.test(root)) {
  throw new Error(`临时目录或仓库路径含空格，这个脚本不处理这种情况：${work} / ${root}`);
}

/**
 * 跑一条 npm 命令。
 * ⚠️ Windows 上 npm 是 `npm.cmd`，而 Node **拒绝**直接 spawn 它（`spawnSync npm.cmd EINVAL`，
 *   CVE-2024-27980 之后的加固）。`shell: true` 能绕过去，但会触发 `DEP0190`（参数不转义、只拼接），
 *   而且那条警告会一直污染 CI 输出。⇒ 显式经 `cmd.exe` 走一趟，参数**保持数组形式**。
 */
const runNpm = (args, opts) => (process.platform === 'win32'
  ? execFileSync('cmd.exe', ['/d', '/c', 'npm', ...args], opts)
  : execFileSync('npm', args, opts));

try {
  // ① 打成一个真正的 tarball
  runNpm(['pack', '--pack-destination', work], { cwd: root, stdio: 'inherit' });
  const tgzName = fs.readdirSync(work).find((f) => f.endsWith('.tgz'));
  if (!tgzName) throw new Error('npm pack 没有产出 .tgz —— 先怀疑尺子（输出目录、权限）');
  const tgz = path.join(work, tgzName);
  step(`tarball: ${tgzName}（${(fs.statSync(tgz).size / 1000).toFixed(1)} kB，与 npm 的 kB 同口径）`);

  // ② 在一个干净目录里**真的装一次**（零依赖 ⇒ 不需要网络）
  const consumer = path.join(work, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'smoke-consumer', type: 'module', private: true }, null, 2),
  );
  runNpm(['install', tgz, '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'inherit' });

  // ③ 从**装好的包**里 import 并跑一条最小计算
  fs.copyFileSync(
    fileURLToPath(new URL('./smoke-consumer.mjs', import.meta.url)),
    path.join(consumer, 'check.mjs'),
  );
  execFileSync(process.execPath, ['check.mjs'], { cwd: consumer, stdio: 'inherit' });

  step('✅ 通过：装得上、import 得到、算得出、IS 口径是中心化的');
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
