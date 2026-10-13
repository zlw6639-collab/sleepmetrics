/**
 * 发布前检查：**README 里的每个内部链接，都必须在 `package.json` 的 `files` 里** —— 否则
 * `npm i` 之后那个链接就是 404（2026-10-13 真踩过：`ROADMAP.md` / `NON-GOALS.md` 没进包）。
 *
 * 用法：`npm run check:links`（CI 里也跑它）
 * 退出码：0 = 全部命中；1 = 有链接指向不会被发布的文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = Array.isArray(pkg.files) ? pkg.files : [];

/** 检查一个 markdown 文件里的所有**相对**链接 */
function internalLinks(mdFile) {
  const md = fs.readFileSync(path.join(root, mdFile), 'utf8');
  const out = [];
  for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (target === '' || /^[a-z]+:/i.test(target)) continue; // 外链、mailto、锚点
    out.push({ from: mdFile, target });
  }
  return out;
}

/**
 * 抓 markdown 里被**反引号**包起来的「看起来像仓库内文件路径」的串。
 *
 * 为什么要单独扫这一类：它们**不是 markdown 链接**，所以永远不会 404，
 * 上面的 `internalLinks()` 也抓不到 —— 但读者在 npm 包里可能根本找不到那个路径。
 * ⚠️ **只警告、不改变退出码**：README 引用 `test/audit.test.js` 是**有意**的
 *    （指向「测试名即规格」，让读者去 GitHub 看），硬要"修"反而删掉了有用的指路。
 */
function codePathRefs(mdFile) {
  const md = fs.readFileSync(path.join(root, mdFile), 'utf8');
  const out = [];
  for (const m of md.matchAll(/`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:js|mjs|json|md|ts|yml|yaml|cff|txt))`/g)) {
    out.push(m[1]);
  }
  return out;
}

/** 该路径会不会被 npm 发布？`files` 是「前缀匹配」语义 */
const willShip = (rel) => files.some((f) => rel === f || rel.startsWith(f + '/') || f.startsWith(rel + '/'));

const mdFiles = ['README.md', 'DISCLAIMER.md', 'ROADMAP.md', 'NON-GOALS.md', 'HOLIDAYS.md'].filter((f) => fs.existsSync(path.join(root, f)));
const problems = [];
let checked = 0;

for (const mdFile of mdFiles) {
  for (const { target } of internalLinks(mdFile)) {
    checked += 1;
    const abs = path.resolve(root, path.dirname(mdFile), target);
    if (!fs.existsSync(abs)) {
      problems.push(`${mdFile} → ${target}  ：文件不存在`);
      continue;
    }
    const relToRoot = path.relative(root, abs).split(path.sep).join('/');
    if (!willShip(relToRoot)) problems.push(`${mdFile} → ${target}  ：文件存在，但**不在发布物里**（package.json 的 files）`);
  }
}

if (problems.length) {
  console.error(`✖ 检查了 ${checked} 个内部链接，发现 ${problems.length} 个会 404：`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

// 「反引号路径盲区」——警告级，**不影响退出码**（见 codePathRefs 的注释）。
const warnings = [];
for (const mdFile of mdFiles) {
  for (const target of codePathRefs(mdFile)) {
    const abs = path.resolve(root, path.dirname(mdFile), target);
    if (!fs.existsSync(abs)) continue; // 纯示例路径（文件本就不存在）不算问题
    const relToRoot = path.relative(root, abs).split(path.sep).join('/');
    if (!willShip(relToRoot)) warnings.push(`${mdFile} 提到 \`${target}\`（存在，但不随包发布）`);
  }
}

console.log(`✅ ${checked} 个内部链接全部命中发布物（files: ${files.join(' · ')}）`);
if (warnings.length) {
  console.log(`ℹ 另有 ${warnings.length} 处「反引号路径引用」指向不发布的文件 —— 它们不会 404，仅提示：`);
  for (const w of warnings) console.log('  ' + w);
  console.log('  （若想让读者找得到，改成链接并加进 files；若只是指路 GitHub，保持现状即可）');
}
