#!/usr/bin/env node
/**
 * The **generic** record ↔ CSV adapter: a standard record array in, a CSV you can open in a
 * spreadsheet out — and the same trip back.
 *
 * ⚠️ **Generic means brand-agnostic.** This file knows the *standard* shape only (`src/records.js`),
 *   so it can never become the "vendor adapter" the library refuses to ship (`NON-GOALS.md` §5).
 *   Whatever your watch exported, map it first — `TIMESTAMPS.md` is that map, and `examples/`
 *   already has one worked example (`mifit-to-lib.mjs`).
 *
 * ⚠️ **Epoch seconds are the only truth.** `bed_epoch` / `wake_epoch` are what the library wants, and
 *   they are what `from-csv` reads. The `bed_iso` / `wake_iso` columns exist **for humans** (so a
 *   spreadsheet shows "2026-03-01T23:30:00+08:00" instead of `1772294400`) and are **ignored on
 *   import, deliberately**: re-parsing an ISO string is exactly the silent-timezone trap that
 *   `TIMESTAMPS.md` spends a whole page on. Read them; never trust them.
 *
 * ⚠️ **Row-count conservation is enforced, and any skip is an error.** The risk this adapter has to
 *   answer for is the one `ROADMAP.md` names: a converter that quietly drops rows yields numbers that
 *   look perfectly fine. So `from-csv` prints `in = out + skipped` with a reason per skipped row, and
 *   **exits 1 if anything was skipped** — a silent drop is not an option, only a counted one.
 *
 * Usage:
 *   node examples/records-csv.mjs to-csv   records.json  [--out-dir DIR]
 *   node examples/records-csv.mjs from-csv records.csv   [--stages stages.csv]
 *
 * `to-csv` prints to stdout when there are no stages; with stages it writes `records.csv` +
 * `stages.csv` into `--out-dir` (two tables cannot share one stdout).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REC_HEAD = ['index', 'bed_epoch', 'wake_epoch', 'dur_min', 'tz', 'bed_iso', 'wake_iso'];
const STG_HEAD = ['record_index', 'start_epoch', 'end_epoch', 'state'];

/**
 * 最小但**正确**的 CSV 转义 —— 与 `export-for-r.mjs` 同一份实现（那里记着 2026-10-14 的事故：
 * note 列带逗号却没加引号 ⇒ R 的 `read.csv()` 把一行读成 5 列、`d$value` 之后全错位）。
 * 手搓 CSV 就必须自己转义，别指望下游容错。
 */
const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * 带**显式偏移**的 ISO 字符串，**只给人看**。
 * ⚠️ 先按偏移平移再取 UTC 表示 —— 这样字符串写的就是"当地钟表时间"，末尾再带上真实偏移，
 *    于是人看着自然、机器解析回来也等于原时刻。导入侧仍然不用它（见文件头）。
 */
function isoWithOffset(sec, tzHours) {
  const tz = Number.isFinite(Number(tzHours)) ? Number(tzHours) : 0;
  const shifted = new Date((Number(sec) + tz * 3600) * 1000);
  if (!Number.isFinite(shifted.getTime())) return '';
  const sign = tz < 0 ? '-' : '+';
  const abs = Math.abs(tz);
  const hh = String(Math.floor(abs)).padStart(2, '0');
  const mm = String(Math.round((abs - Math.floor(abs)) * 60)).padStart(2, '0');
  return `${shifted.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

/**
 * 最小但**正确**的 CSV 解析：引号包裹、字段内逗号、字段内换行、`""` 转义、CRLF。
 * ⚠️ **不能用 `split(',')`**：本例自己导出的 CSV 里就可能有带逗号/换行的字段，
 *    而"读得进来但错位"正是这一层最该防的事（与上面 `esc` 的踩坑互为镜像）。
 * @returns {string[][]} 行 × 单元格（末尾空行已去掉）
 */
function csvParse(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, ''); // 容忍别处生成的 BOM
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; }
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** records（+ stages）→ 两张 CSV 文本 */
export function recordsToCsv(records) {
  if (!Array.isArray(records)) throw new Error('recordsToCsv 要一个数组（见 src/records.js 的标准形状）');
  const recRows = [REC_HEAD.join(',')];
  const stgRows = [STG_HEAD.join(',')];
  records.forEach((r, i) => {
    const o = (r && typeof r === 'object') ? r : {};
    const tz = o.tz === undefined || o.tz === null ? '' : o.tz;
    const tzForIso = tz === '' ? 0 : Number(tz);
    recRows.push([
      i,
      Number.isFinite(Number(o.bed)) ? o.bed : '',
      Number.isFinite(Number(o.wake)) ? o.wake : '',
      o.dur === undefined || o.dur === null ? '' : o.dur,
      tz,
      Number.isFinite(Number(o.bed)) ? isoWithOffset(o.bed, tzForIso) : '',
      Number.isFinite(Number(o.wake)) ? isoWithOffset(o.wake, tzForIso) : '',
    ].map(esc).join(','));
    if (Array.isArray(o.stages)) {
      for (const st of o.stages) {
        stgRows.push([i, st?.start ?? '', st?.end ?? '', st?.state ?? ''].map(esc).join(','));
      }
    }
  });
  const nStages = records.reduce((n, r) => n + (Array.isArray(r?.stages) ? r.stages.length : 0), 0);
  // ★ 守恒自检（导出侧）：写出的行数必须与输入逐条对得上
  if (recRows.length - 1 !== records.length) throw new Error('导出侧守恒失败：行数与记录数不符');
  if (stgRows.length - 1 !== nStages) throw new Error('导出侧守恒失败：行数与分段数不符');
  return { recordsCsv: `${recRows.join('\n')}\n`, stagesCsv: `${stgRows.join('\n')}\n`, nStages };
}

/**
 * 两张 CSV 文本 → 标准记录数组。**任何跳过都计数并给理由**（调用方据此决定退出码）。
 * @returns {{records: object[], skipped: Array<{row: number, why: string}>, out: number}}
 */
export function csvToRecords(recordsCsv, stagesCsv = '') {
  const rows = csvParse(recordsCsv);
  if (!rows.length) return { records: [], skipped: [{ row: 0, why: '文件是空的' }], out: 0 };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  // ⚠️ 必填列缺失 ⇒ 直接报错（不是"逐行跳过"）：那说明拿错了文件或列名被改过，
  //    继续跑只会产出一堆看似合理的空记录。
  for (const need of ['bed_epoch', 'wake_epoch']) {
    if (col(need) < 0) throw new Error(`CSV 缺必填列 ${need}（现有列：${head.join(', ')}）`);
  }
  const iBed = col('bed_epoch'); const iWake = col('wake_epoch'); const iDur = col('dur_min');
  const iTz = col('tz'); const iIdx = col('index');

  const records = [];
  const skipped = [];
  const byIndex = new Map();   // 导出的 index → 输出记录下标（供 stages 关联）
  rows.slice(1).forEach((cells, k) => {
    const line = k + 2;                                   // 1 起 + 跳过表头
    const rawBed = (cells[iBed] ?? '').trim();
    const rawWake = (cells[iWake] ?? '').trim();
    const bed = Number(rawBed);
    const wake = Number(rawWake);
    // 判据与 `recordFaults()` 同一边界：epoch 秒必须是**正数**且 wake > bed
    if (!rawBed || !Number.isFinite(bed) || bed <= 0) { skipped.push({ row: line, why: `bed_epoch 不是正数（'${rawBed}'）` }); return; }
    if (!rawWake || !Number.isFinite(wake) || wake <= 0) { skipped.push({ row: line, why: `wake_epoch 不是正数（'${rawWake}'）` }); return; }
    if (wake <= bed) { skipped.push({ row: line, why: 'wake 不晚于 bed' }); return; }

    const rec = { bed, wake };
    const rawDur = iDur >= 0 ? (cells[iDur] ?? '').trim() : '';
    if (rawDur) {
      const d = Number(rawDur);
      if (!Number.isFinite(d)) { skipped.push({ row: line, why: `dur_min 不是数字（'${rawDur}'）` }); return; }
      rec.dur = d;
    }
    const rawTz = iTz >= 0 ? (cells[iTz] ?? '').trim() : '';
    if (rawTz) {
      const z = Number(rawTz);
      if (!Number.isFinite(z)) { skipped.push({ row: line, why: `tz 不是数字（'${rawTz}'）` }); return; }
      rec.tz = z;   // ⚠️ 范围校验交给 `auditRecords()`（tz.out-of-range）——适配器保持薄
    }
    records.push(rec);
    if (iIdx >= 0) {
      const idx = Number((cells[iIdx] ?? '').trim());
      if (Number.isFinite(idx)) byIndex.set(idx, records.length - 1);
    }
  });

  if (stagesCsv && stagesCsv.trim()) {
    const srows = csvParse(stagesCsv);
    const shead = srows.length ? srows[0].map((h) => h.trim().toLowerCase()) : [];
    const sIdx = shead.indexOf('record_index');
    const sStart = shead.indexOf('start_epoch');
    const sEnd = shead.indexOf('end_epoch');
    const sState = shead.indexOf('state');
    if (sIdx < 0 || sStart < 0 || sEnd < 0) throw new Error('stages.csv 缺列（要 record_index, start_epoch, end_epoch, state）');
    srows.slice(1).forEach((cells, k) => {
      const line = k + 2;
      const ri = Number((cells[sIdx] ?? '').trim());
      const target = byIndex.has(ri) ? records[byIndex.get(ri)] : null;
      if (!target) { skipped.push({ row: `stages:${line}`, why: `record_index=${cells[sIdx]} 在 records.csv 里找不到（该记录本身被跳过了？）` }); return; }
      const start = Number((cells[sStart] ?? '').trim());
      const end = Number((cells[sEnd] ?? '').trim());
      const state = sState >= 0 ? Number((cells[sState] ?? '').trim()) : undefined;
      if (!Number.isFinite(start) || !Number.isFinite(end)) { skipped.push({ row: `stages:${line}`, why: 'start/end 不是数字' }); return; }
      if (!target.stages) target.stages = [];
      target.stages.push(Number.isFinite(state) ? { start, end, state } : { start, end });
    });
  }

  return { records, skipped, out: records.length };
}

/* ───────────────────────────── CLI ───────────────────────────── */
// ⚠️ 逻辑与 CLI 分开，且**必须能被 import**：`bin/sleepmetrics.js` 那次的教训是"executes on import
//    就测不了"，而"看起来没问题"不是规格（ROADMAP 的 bedtime-heatmap 条目记着这条）。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const file = argv[1];
  const valOf = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
  const outDir = valOf('out-dir', null);
  const stagesPath = valOf('stages', null);
  const usage = 'usage:\n  node examples/records-csv.mjs to-csv   <records.json> [--out-dir DIR]\n  node examples/records-csv.mjs from-csv <records.csv>  [--stages stages.csv]';

  if (!mode || !file || !['to-csv', 'from-csv'].includes(mode)) { console.error(usage); process.exit(2); }

  if (mode === 'to-csv') {
    const records = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { recordsCsv, stagesCsv, nStages } = recordsToCsv(records);
    if (nStages > 0 && !outDir) {
      console.error(`⚠️ 这份数据里有 ${nStages} 个分段 ⇒ 需要两张表，请给 --out-dir DIR（不能都写 stdout）。`);
      console.error(usage); process.exit(2);
    }
    if (outDir) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'records.csv'), recordsCsv, 'utf8');
      if (nStages > 0) fs.writeFileSync(path.join(outDir, 'stages.csv'), stagesCsv, 'utf8');
      console.error(`✅ 写出 ${records.length} 行记录${nStages ? ` + ${nStages} 行分段` : ''} → ${outDir}`);
      console.error('⚠️ bed_iso / wake_iso 只给人看；**导回时一律以 epoch 秒为准**（TIMESTAMPS.md）。');
    } else {
      process.stdout.write(recordsCsv);
      console.error(`✅ ${records.length} 行记录（无分段）→ stdout`);
    }
    process.exit(0);
  }

  // from-csv
  const recordsCsv = fs.readFileSync(file, 'utf8');
  const stagesCsv = stagesPath ? fs.readFileSync(stagesPath, 'utf8') : '';
  const { records, skipped, out } = csvToRecords(recordsCsv, stagesCsv);
  const inRows = csvParse(recordsCsv).length - 1;
  console.log(JSON.stringify(records, null, 2));
  // ★ 守恒：**进 = 出 + 跳过**，逐条给理由；有任何跳过 ⇒ 退出码 1（静默丢行不是选项）
  console.error(`\n--- 守恒自检 ---`);
  console.error(`  进 ${inRows} 行 = 出 ${out} 条 + 跳过 ${skipped.length}${skipped.length ? '  ⚠️' : '  ✅'}`);
  for (const s of skipped) console.error(`  ✏️ [跳过] 第 ${s.row} 行：${s.why}`);
  if (skipped.length) {
    console.error('⚠️ 有行被跳过 ⇒ 退出码 1（**别把这份数字当完整数据**；修好 CSV 再跑）。');
    process.exit(1);
  }
  console.error('⚠️ 下一步：把这批记录喂给 `auditRecords()` —— 它抓得到本适配器**看不见**的东西（毫秒、越界 tz、编码错位）。');
  process.exit(0);
}
