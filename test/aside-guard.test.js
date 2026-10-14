/**
 * ★ 规矩的钉子：**生理指标路径不许有旁白**（2026-10-14 立）。
 *
 * 为什么用「读源码」而不是普通单元测试：
 *   `aside()` 定义在 `bin/sleepmetrics.js`，而 bin 是**顶层执行**的 CLI（import 就会跑、还会
 *   `process.exit`）⇒ **没法 import 进测试**。这也正是 AGENTS.md 第 6 条那句
 *   「42 个测试全绿是真的 —— 它不加载 bin」的由来。
 *
 * ⇒ 退一步：断言**调用点**（`aside({...})` 的实参键名）里没有任何生理指标键，
 *   并断言**守卫本身还在**（能防住未来给它接上心率 / HRV 的人）。
 *
 * 为什么这条规矩要紧：生理指标上的"趣味解读"极易被读成**医疗暗示**，
 * 而心率 / HRV 这类数据本身最容易引发焦虑 —— 它与「不做医疗建议」是同一条底线的两面。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../bin/sleepmetrics.js', import.meta.url), 'utf8');
const PHYSIO = ['hr', 'hrv', 'bpm', 'spo2', 'heart', 'resp', 'breath', 'temp', 'stress', 'rhr'];

test('★ 生理指标不许接旁白：bin 里 aside() 的每个调用点都不得含生理键', () => {
  const calls = [...SRC.matchAll(/aside\(\{([^}]*)\}/g)].map((m) => m[1]);

  // ⚠️ 非空守卫（AGENTS.md 第 6 条）：找不到调用点时必须**失败**，
  //    否则"零个调用点"会让下面的循环空转 ⇒ 假通过。
  assert.ok(calls.length > 0, `一个 aside() 调用点都没找到（正则或文件结构变了）—— 这不叫通过`);

  for (const raw of calls) {
    const names = [...raw.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1].toLowerCase());
    assert.ok(names.length > 0, `调用点 aside({${raw.trim()}}) 解析不出任何键名 —— 别当成通过`);
    for (const k of names) {
      for (const p of PHYSIO) {
        assert.ok(!k.includes(p),
          `调用点 aside({${raw.trim()}}) 出现生理指标键 "${k}" ⇒ 违反 AGENTS.md「生理指标禁旁白」`);
      }
    }
  }
});

test('★ 守卫本身还在（能被悄悄删掉的不算警告）', () => {
  assert.ok(/const PHYSIO_KEYS = \[/.test(SRC), 'PHYSIO_KEYS 禁区清单不见了');
  assert.ok(/PHYSIO_KEYS\.some\(/.test(SRC), 'aside() 里的禁区判定语句不见了');
  assert.ok(/function aside\(ctx = \{\}\)/.test(SRC),
    'aside() 的签名退回了解构参数 ⇒ 拿不到原始键名，守卫会失效');
});
