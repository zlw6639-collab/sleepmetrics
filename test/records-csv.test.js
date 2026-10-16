import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToCsv, csvToRecords } from '../examples/records-csv.mjs';

/**
 * 两条合成记录（一条带分段），时间落在 2026-03 —— 只用合成数据（真实健康数据绝不进仓库）。
 * `1772294400` = 2026-03-01 00:00 (+08:00)，与 `TIMESTAMPS.md` 的算例同一个值。
 */
const sample = () => [
  {
    bed: 1772294400,
    wake: 1772323200,
    dur: 470,
    tz: 8,
    stages: [
      { start: 1772294400, end: 1772301600, state: 2 },
      { start: 1772301600, end: 1772323200, state: 3 },
    ],
  },
  { bed: 1772380800, wake: 1772410000, tz: 8 },
];

const head = 'index,bed_epoch,wake_epoch,dur_min,tz,bed_iso,wake_iso';

test('★ records-csv 往返无损：records → CSV → records 逐字段相等', () => {
  const src = sample();
  const { recordsCsv, stagesCsv } = recordsToCsv(src);
  const { records, skipped } = csvToRecords(recordsCsv, stagesCsv);
  assert.equal(skipped.length, 0, `不该有跳过：${JSON.stringify(skipped)}`);
  assert.deepEqual(records, src);
});

test('★ records-csv 守恒：坏行必须被计数并给出理由（静默丢行不是选项）', () => {
  const csv = [
    head,
    '0,1772294400,1772323200,,8,,',
    '1,0,1772323200,,8,,',            // bed 不是正数
    '2,1772380800,1772380800,,8,,',   // wake 不晚于 bed
    '3,,1772323200,,8,,',             // bed 为空
  ].join('\n');
  const { records, skipped, out } = csvToRecords(csv);
  assert.equal(records.length, 1);
  assert.equal(skipped.length, 3, `每一条坏行都要有理由：${JSON.stringify(skipped)}`);
  assert.equal(out, records.length);
  assert.match(skipped.map((s) => s.why).join(' | '), /bed_epoch/);
  assert.match(skipped.map((s) => s.why).join(' | '), /wake 不晚于 bed/);
});

test('★ records-csv：ISO 两列只给人看 —— 把它们改成假的也不影响导入', () => {
  // 这条钉住的正是 TIMESTAMPS.md 那一整页的坑：**不要**让 ISO 字符串再决定一次时刻。
  const csv = [
    head,
    '0,1772294400,1772323200,,8,1999-01-01T00:00:00+08:00,1999-01-01T00:00:00+08:00',
  ].join('\n');
  const { records, skipped } = csvToRecords(csv);
  assert.equal(skipped.length, 0);
  assert.equal(records[0].bed, 1772294400, '导入只认 epoch 秒');
  assert.equal(records[0].wake, 1772323200);
});

test('★ records-csv：解析器要能读回自己写的东西（引号 / CRLF 不许串行）', () => {
  const csv = `${head}\r\n0,1772294400,1772323200,"470","8","",""\r\n`;
  const { records } = csvToRecords(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].dur, 470);
  assert.equal(records[0].tz, 8);

  // 字段里带逗号与换行：`esc` 会加引号包裹，解析必须把它当成**一个**单元格。
  // 于是 `dur_min` 成了 `1,5` ⇒ 它是**坏行**（被计数、不是静默变成两列 —— 那会让 tz 跟着错位）。
  const tricky = `${head}\n0,1772294400,1772323200,"1,5","8"\n`;
  const t = csvToRecords(tricky);
  assert.equal(t.records.length, 0, '带逗号的 dur 不该被当成两条数据（那说明解析器把一格拆成了两列）');
  assert.match(t.skipped.map((s) => s.why).join(' | '), /dur_min 不是数字/);
});

test('records-csv：缺必填列 ⇒ 抛错（不是逐行跳过 —— 那通常意味着拿错了文件）', () => {
  assert.throws(() => csvToRecords('a,b\n1,2\n'), /缺必填列/);
});

test('★ records-csv：stages 双表可逆；记录被跳过时它的分段也必须报出来', () => {
  const { recordsCsv, stagesCsv } = recordsToCsv(sample());
  const ok = csvToRecords(recordsCsv, stagesCsv);
  assert.equal(ok.records[0].stages.length, 2);
  assert.deepEqual(ok.records[0].stages[0], { start: 1772294400, end: 1772301600, state: 2 });

  // 把第 0 条的 bed 弄坏 ⇒ 它进不了输出 ⇒ 挂在它名下的两个 stage 无处可去 ⇒ 必须计入跳过
  const broken = recordsCsv.replace('0,1772294400', '0,0');
  const bad = csvToRecords(broken, stagesCsv);
  assert.equal(bad.records.length, 1);
  const why = bad.skipped.map((s) => String(s.why)).join(' | ');
  assert.match(why, /找不到/, `分段指向被跳过的记录时必须报出来，实际：${why}`);
});
