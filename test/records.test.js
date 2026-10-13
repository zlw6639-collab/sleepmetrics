import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, allSleep, mainSleep, dailyMain } from '../src/records.js';
import * as fx from './fixtures/synthetic.mjs';

test('normalize：丢掉 bed/wake 非正的记录、补 dur、按 bed 升序、归到醒来日', () => {
  const out = normalize([
    { bed: fx.at(fx.d(2), 1), wake: fx.at(fx.d(2), 9) },
    { bed: 0, wake: fx.at(fx.d(3), 9) },
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9) },
  ], fx.TZ);
  assert.equal(out.length, 2);
  assert.equal(out[0].ds, '2026-03-01');
  assert.equal(out[1].ds, '2026-03-02');
  assert.equal(out[0].dur, 480);
});

test('allSleep 含小睡；mainSleep 只留「严格大于」门槛的段', () => {
  const recs = [
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: fx.TZ }, // 480
    { bed: fx.at(fx.d(1), 14), wake: fx.at(fx.d(1), 15), tz: fx.TZ }, // 60 小睡
  ];
  assert.equal(allSleep(recs, fx.TZ).length, 2);
  assert.equal(mainSleep(recs, 180, fx.TZ).length, 1);
});

test('dailyMain：同一醒来日只取最长的一段（这正是与 analyze.mjs 对齐的那套口径）', () => {
  const recs = [
    { bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 9), tz: fx.TZ }, // 480
    { bed: fx.at(fx.d(1), 10), wake: fx.at(fx.d(1), 14), tz: fx.TZ }, // 240（同日第二段，也达标）
  ];
  assert.equal(mainSleep(recs, 180, fx.TZ).length, 2); // 都达标 ⇒ 都留下
  assert.equal(dailyMain(recs, 180, fx.TZ).length, 1); // 按日去重 ⇒ 只留最长的
  assert.equal(dailyMain(recs, 180, fx.TZ)[0].dur, 480);
});

test('dailyMain 门槛是「≥」，mainSleep 是「>」—— 两处刻意差异，别统一', () => {
  const exactly180 = [{ bed: fx.at(fx.d(1), 1), wake: fx.at(fx.d(1), 4), tz: fx.TZ }];
  assert.equal(dailyMain(exactly180, 180, fx.TZ).length, 1); // analyze.mjs: if (dur < 180) continue
  assert.equal(mainSleep(exactly180, 180, fx.TZ).length, 0); // metrics.mjs: if (!(dur > 180)) continue
});
