/**
 * 适配器示例：把「小米运动健康云端导出」转成 sleepmetrics 的标准记录形状。
 *
 * ⚠️ 本文件**不属于库**（package.json 的 `files` 里没有 `examples/`）——
 *    它认识小米的字段名（`bedtime` / `device_wake_up_time` / `items[].start_time`…），
 *    那属于「认品牌」，是适配器层的活。库本身只吃标准形状（见 `src/records.js` 顶部注释）。
 *
 * 用法：
 *   node examples/mifit-to-lib.mjs "E:\ai\mifit\raw\sleep.json" > records.json
 *
 * ⚠️ 红线（项目方案 §五 第 1 条）：`raw/` 里的真实健康数据**绝不进仓库**，也**不要**把
 *    转换结果提交上去 —— 它和原始数据一样敏感。
 */
import fs from 'node:fs';

/** 小米云接口把 value 存成 JSON 字符串（也可能已经是对象） */
const P = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/**
 * @param {Array<object>} rawRecords 小米原始记录数组
 * @param {number} [tz=8] 时区偏移（小时）
 * @returns {Array<object>} sleepmetrics 标准记录数组
 */
export function mifitToRecords(rawRecords, tz = 8) {
  const out = [];
  for (const r of rawRecords ?? []) {
    let v;
    try {
      v = P(r?.value ?? r);
    } catch {
      continue; // 坏记录跳过，别让一行坏数据毁掉整次转换
    }
    if (v === null || typeof v !== 'object') continue;

    const bed = Number(v.bedtime ?? v.bed_timestamp);
    const wake = Number(v.device_wake_up_time ?? v.wake_up_time);
    if (!(bed > 0) || !(wake > 0)) continue;

    const dur = Number(v.duration ?? Math.round((wake - bed) / 60));
    if (!Number.isFinite(dur)) continue;

    const rec = { bed, wake, tz, dur };
    if (Array.isArray(v.items) && v.items.length) {
      // 小米 state 编码：2=深睡 3=浅睡 4=REM 5=清醒（与库的标准编码一致，故直接映射）
      rec.stages = v.items.map((it) => ({
        start: Number(it.start_time),
        end: Number(it.end_time),
        state: Number(it.state),
      }));
    }
    out.push(rec);
  }
  return out.sort((a, b) => a.bed - b.bed);
}

// CLI：传路径就转换并打到 stdout（读文件只发生在示例/CLI 层）
const arg = process.argv[2];
if (arg) {
  const raw = JSON.parse(fs.readFileSync(arg, 'utf8'));
  const records = mifitToRecords(raw);
  process.stdout.write(JSON.stringify(records));
  process.stderr.write(`\n[examples] ${raw.length} 条原始记录 → ${records.length} 条标准记录\n`);
}
