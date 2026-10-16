/**
 * 就寝热图的规格 —— **测试名就是规格**（`AGENTS.md` 第 2 条）。
 *
 * 这个文件存在的理由：热图的映射逻辑在 `bin/heatmap.js` 而不是顶层脚本里，所以它能被
 * 真的跑起来、真的断言 —— 而不是靠"肉眼看图没毛病"。
 *
 * ⚠️ 头号陷阱（`ROADMAP.md` 里记着的那条）：**就寝时刻必须按圆周映射**。
 *    这几条测试就是它的守卫：23:50 与 00:10 只差 20 分钟，任何"线性铺到 00:00–24:00"的实现
 *    都会把它们甩到标尺两端，于是图上长出一个不存在的"作息剧变"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildHeatmap, renderHeatmap, levelOf, charOf, colOf, mondayOf,
  LEVEL_CHARS, MISSING_CHAR, CENTER_MINUTES, SCALE_MINUTES,
} from '../bin/heatmap.js';
import * as fx from './fixtures/synthetic.mjs';

/** 跨午夜相邻的两晚：23:50 睡，隔一晚 00:10 睡（相差 20 分钟） */
const wrapPair = () => [
  { bed: fx.at(fx.d(1), 23, 50), wake: fx.at(fx.d(2), 7, 50), tz: fx.TZ },
  { bed: fx.at(fx.d(3), 0, 10), wake: fx.at(fx.d(3), 8, 10), tz: fx.TZ },
];

/** n 晚规律睡眠（01:00–09:00），一个自然日一晚 */
const runOf = (n) => Array.from({ length: n }, (_, i) => ({
  bed: fx.at(fx.d(i + 1), 1),
  wake: fx.at(fx.d(i + 1), 9),
  tz: fx.TZ,
}));

const cellsOf = (hm) => hm.rows.flatMap((r) => r.cells).filter(Boolean);

test('★ 跨午夜相邻的两晚落在同一档：23:50 与 00:10 只差 20 分钟（线性铺到 00:00–24:00 会把它们画到标尺两端）', () => {
  const hm = buildHeatmap(wrapPair());
  const cells = cellsOf(hm);
  assert.equal(cells.length, 2);
  assert.equal(
    cells[0].char, LEVEL_CHARS[2],
    `23:50 应当落在中心档，实际 ${cells[0].char}（offset ${cells[0].offset} 分钟）`,
  );
  assert.equal(
    cells[1].char, LEVEL_CHARS[2],
    `00:10 应当落在中心档，实际 ${cells[1].char}（offset ${cells[1].offset} 分钟）`,
  );
  // ★ 反向守卫：两格偏移必须靠在一起。线性刻度下它们的差会接近一整天（±720 级），
  //   而这里必须 ≤ 中心档的两倍宽 —— 也就是说，这条断言**只有当映射是圆周的**才成立。
  const gap = Math.abs(cells[1].offset - cells[0].offset);
  assert.ok(gap <= 2 * CENTER_MINUTES, `两晚偏移相差 ${gap} 分钟 —— 圆周映射失效了`);
});

test('★ 缺主睡眠的夜晚有自己的字符（?），不许和「就寝很准」混为一谈', () => {
  const recs = [
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: fx.TZ }, // 主睡眠
    { bed: fx.at(fx.d(2), 8), wake: fx.at(fx.d(2), 8, 26), tz: fx.TZ }, // 26 分钟小睡 ⇒ 不算主睡眠
    { bed: fx.at(fx.d(3), 1), wake: fx.at(fx.d(3), 9), tz: fx.TZ }, // 主睡眠
  ];
  const hm = buildHeatmap(recs);
  const cells = cellsOf(hm);
  assert.deepEqual(cells.map((c) => c.ds), ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.equal(cells[1].char, MISSING_CHAR, '缺主睡眠的那晚必须是 ?');
  assert.equal(cells[1].bed, null);
  assert.equal(hm.missing, 1);
  // 缺的那一格不许是中心字符 —— 那会把"没数据"读成"睡得很准"
  assert.notEqual(cells[1].char, LEVEL_CHARS[2]);
});

test('档位判据完全对称：±30 都在中心档、±90 都在最外档，非有限数不猜', () => {
  assert.equal(levelOf(0), 2);
  assert.equal(levelOf(CENTER_MINUTES), 2);
  assert.equal(levelOf(-CENTER_MINUTES), 2);
  assert.equal(levelOf(CENTER_MINUTES + 1), 3);
  assert.equal(levelOf(-CENTER_MINUTES - 1), 1);
  assert.equal(levelOf(SCALE_MINUTES), 4);
  assert.equal(levelOf(-SCALE_MINUTES), 0);
  assert.equal(levelOf(Number.NaN), null);
  assert.equal(charOf(Number.NaN), MISSING_CHAR);
});

test('一周一行、列首是周一：行内每格的列序与 colOf() 一致，行标签本身就是周一', () => {
  const hm = buildHeatmap(runOf(10));
  assert.ok(hm.rows.length >= 2, '十晚应当跨至少两行');
  for (const row of hm.rows) {
    assert.equal(mondayOf(row.weekLabel), row.weekLabel);
    row.cells.forEach((c, idx) => {
      if (c !== null) assert.equal(colOf(c.ds), idx, `${c.ds} 应落在第 ${idx} 列`);
    });
  }
});

test('★ 窗口锚点 = 主睡眠最后一条的 wake（与 sriLastN 同一口径）：近 3 晚可以覆盖 4 个自然日', () => {
  const hm = buildHeatmap(runOf(10), { window: 3 });
  // 锚 = 第 10 晚的 wake（03-10 09:00）；窗口向前 3×24h ⇒ 第 7 晚的 wake 恰好落在边界上（含）
  // ⇒ 4 晚。这不是 bug，正是「N 晚可以跨 N+1 个自然日」那条口径（README §Semantics 第 6 条）。
  assert.equal(hm.nights, 4);
  assert.equal(hm.from, '2026-03-07');
  assert.equal(hm.to, '2026-03-10');
});

test('渲染：列头与数据行等宽；图例必须写出中心时刻与刻度（否则读者只能自己猜）', () => {
  const lines = renderHeatmap(buildHeatmap(runOf(9)));
  const header = lines[1];
  const dataLines = lines.filter((l) => /^\d{4}-\d{2}-\d{2} /.test(l));
  assert.ok(dataLines.length >= 1, '至少要有一行数据');
  for (const l of dataLines) assert.equal(l.length, header.length, `行宽不一致：${l}`);
  assert.ok(lines[0].includes('圆周均值'), '标题必须说明中心是圆周均值');
  assert.ok(lines[0].includes(`±${SCALE_MINUTES}`), '标题必须写出刻度');
  assert.ok(lines.some((l) => l.startsWith('图例：')), '必须有图例');
});

test('没有主睡眠 ⇒ 不硬画（nights = 0、center = null、渲染出空数组）', () => {
  const hm = buildHeatmap([{ bed: fx.at(fx.d(1), 8), wake: fx.at(fx.d(1), 8, 26), tz: fx.TZ }]);
  assert.equal(hm.nights, 0);
  assert.equal(hm.center, null);
  assert.deepEqual(renderHeatmap(hm), []);
});

test('★ CLI：heatmap 拒绝 --json（人类可读路径专用，--json 的键集合是机器契约）', () => {
  const src = fs.readFileSync(new URL('../bin/sleepmetrics.js', import.meta.url), 'utf8');
  assert.ok(src.includes("args.cmd === 'heatmap'"), 'bin 里应有 heatmap 分支');
  assert.ok(src.includes("'audit', 'heatmap'"), 'heatmap 必须在命令白名单里（否则只会打印用法）');
  const branch = src.slice(src.indexOf("args.cmd === 'heatmap'"));
  assert.ok(
    /if \(args\.json\)[\s\S]{0,260}process\.exit\(1\)/.test(branch),
    'heatmap 分支必须在给了 --json 时**可见地**拒绝（静默忽略会让写脚本的人以为拿到了 JSON）',
  );
  assert.ok(
    branch.includes('buildHeatmap(records'),
    '分支要把 records 交给 buildHeatmap',
  );
  assert.ok(
    branch.includes('renderHeatmap(hm)'),
    '再把结果交给 renderHeatmap —— 别在 CLI 里另写一份映射',
  );
});
