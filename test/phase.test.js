import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePhase, minToClock, chronotype, compareChronotype } from '../src/phase.js';
import { DISCLAIMER } from '../src/disclaimer.js';
import { normalize, mainSleep } from '../src/records.js';
import * as fx from './fixtures/synthetic.mjs';

test('MSW / MSF / SJL 手算对照（跨午夜也必须走 shorter 口径）', () => {
  // 注入式休息日判定：库不认识日历，只认这个函数（§10.2 硬边界）
  const isRest = (ds) => ds === '2026-03-07';
  const recs = normalize([
    { bed: fx.at('2026-03-02', 23), wake: fx.at('2026-03-03', 6), tz: fx.TZ }, // 工作日 23:00 睡 7h
    { bed: fx.at('2026-03-07', 0, 30), wake: fx.at('2026-03-07', 8, 30), tz: fx.TZ }, // 休息日 00:30 睡 8h
  ], fx.TZ);

  const p = computePhase(recs, isRest, { windowDays: 30 });
  assert.equal(Math.round(p.soW), 1380); // 23:00
  assert.equal(Math.round(p.soF), 30); // 00:30
  assert.equal(Math.round(p.sdW), 420); // 7h
  assert.equal(Math.round(p.sdF), 480); // 8h
  assert.equal(Math.round(p.sdWeek), 450); // (420+480)/2
  assert.equal(Math.round(p.msw), 150); // 1380 + 420/2 = 1590 → 150（跨午夜取模）
  assert.equal(Math.round(p.msf), 270); // 30 + 480/2
  assert.equal(Math.round(p.msfsc), 255); // 30 + 450/2
  assert.equal(Math.round(p.sjl), 120); // circDiff(270, 150)
  assert.equal(Math.round(p.sjlSc), 105); // circDiff(255, 150)
});

test('缺休息日（或只有休息日）⇒ insufficient，不硬算', () => {
  const recs = mainSleep([
    { bed: fx.at('2026-03-02', 1), wake: fx.at('2026-03-02', 9), tz: fx.TZ },
    { bed: fx.at('2026-03-03', 1), wake: fx.at('2026-03-03', 9), tz: fx.TZ },
  ], 180, fx.TZ);
  const p = computePhase(recs, () => false, { windowDays: 30 });
  assert.equal(p.insufficient, true);
  assert.equal(p.nF, 0);
  assert.equal(p.nW, 2);
});

test('空输入 ⇒ null', () => {
  assert.equal(computePhase([], () => true), null);
});

test('minToClock 会取模并补零', () => {
  assert.equal(minToClock(0), '00:00');
  assert.equal(minToClock(1430), '23:50');
  assert.equal(minToClock(1590), '02:30'); // 1590 % 1440
  assert.equal(minToClock(null), null);
});

test('chronotype：切点由调用方注入（本库不写死任何钟点）', () => {
  const cuts = [120, 240, 360, 480]; // 例如某人群的五分位
  const labels = ['extreme early', 'early', 'intermediate', 'late', 'extreme late'];
  assert.equal(chronotype(60, { cuts, labels }).label, 'extreme early');
  assert.equal(chronotype(200, { cuts, labels }).label, 'early');
  assert.equal(chronotype(500, { cuts, labels }).label, 'extreme late');
  assert.equal(chronotype(500, { cuts, labels }).index, 4);
});

test('chronotype：不给切点 / 切点不递增 / 输入非法 ⇒ null（不猜）', () => {
  assert.equal(chronotype(300), null);
  assert.equal(chronotype(300, { cuts: [] }), null);
  assert.equal(chronotype(300, { cuts: [100, 50] }), null);
  assert.equal(chronotype(Number.NaN, { cuts: [100] }), null);
});

test('chronotype：labels 长度不匹配 ⇒ 退回数字标签（不静默错位）', () => {
  const r = chronotype(200, { cuts: [100, 300], labels: ['只有一个'] });
  assert.equal(r.index, 1);
  assert.equal(r.label, '2');
});

test('compareChronotype：一致 / 行为更晚 / 行为更早 三种方向', () => {
  const labels = ['a', 'b', 'c', 'd', 'e'];
  const same = compareChronotype({ activityIndex: 2, questionnaireIndex: 2, labels });
  assert.equal(same.agree, true);
  assert.equal(same.direction, 'same');
  assert.equal(same.delta, 0);

  const later = compareChronotype({ activityIndex: 4, questionnaireIndex: 2, labels });
  assert.equal(later.agree, false);
  assert.equal(later.direction, 'activity-later');
  assert.equal(later.delta, 2);
  assert.equal(later.activity.label, 'e');
  assert.equal(later.questionnaire.label, 'c');

  const earlier = compareChronotype({ activityIndex: 0, questionnaireIndex: 3, labels });
  assert.equal(earlier.direction, 'activity-earlier');
  assert.equal(earlier.delta, -3);
});

test('compareChronotype：容差参数可以放宽"一致"的判定', () => {
  const r = compareChronotype({ activityIndex: 4, questionnaireIndex: 3, tolerance: 1 });
  assert.equal(r.agree, true);
  assert.equal(r.delta, 1); // delta 照实报，不被容差掩盖
});

test('★ compareChronotype：不一致时给中性解释（"很常见"），且带明确禁令与免责', () => {
  const r = compareChronotype({ activityIndex: 4, questionnaireIndex: 1 });
  assert.equal(r.agree, false);
  assert.match(r.note, /很常见/); // 不制造焦虑
  assert.match(r.note, /不表示/); // 不给诊断
  assert.match(r.note, /不要.*据此调整任何治疗/); // 明确禁令
  assert.equal(r.disclaimer, DISCLAIMER);
});

test('compareChronotype：参数不合法 ⇒ null（不猜档位）', () => {
  assert.equal(compareChronotype({ activityIndex: 1.5, questionnaireIndex: 1 }), null);
  assert.equal(compareChronotype({ activityIndex: -1, questionnaireIndex: 1 }), null);
  assert.equal(compareChronotype({}), null);
});
