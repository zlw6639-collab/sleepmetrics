import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRestJudge, dowOf, isWeekend } from '../src/rest.js';

const holidays = JSON.parse(
  fs.readFileSync(new URL('../data/holidays.json', import.meta.url), 'utf8'),
);
const rest = makeRestJudge(holidays);

/** 找某年里星期几为 dow 的一天（避免测试里手写错的日期） */
function findDow(year, dow) {
  for (let m = 1; m <= 12; m += 1) {
    for (let day = 1; day <= 28; day += 1) {
      const ds = `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (dowOf(ds) === dow) return ds;
    }
  }
  throw new Error('unreachable');
}

test('调休上班的周六 ⇒ 判成工作日（这条最会骗人）', () => {
  assert.equal(dowOf('2026-10-10'), 6, '2026-10-10 应当是周六');
  assert.equal(rest.isMakeupWorkday('2026-10-10'), true);
  assert.equal(rest.isRest('2026-10-10'), false);
});

test('国庆连休里的周六 ⇒ 判成休息日', () => {
  assert.equal(dowOf('2026-10-03'), 6);
  assert.equal(rest.isHoliday('2026-10-03'), true);
  assert.equal(rest.isRest('2026-10-03'), true);
});

test('普通周五是工作日、普通周日是休息日', () => {
  assert.equal(rest.isRest('2026-10-09'), false); // 周五
  assert.equal(rest.isRest('2026-10-11'), true); // 周日
});

test('缺年份 ⇒ 退化成「只按周末」，且 missingYears 能明说出来（不静默算错）', () => {
  const sat = findDow(2027, 6);
  const sun = findDow(2027, 0);
  assert.equal(rest.isRest(sat), true);
  assert.equal(rest.isRest(sun), true);
  assert.deepEqual(rest.missingYears([sat, sun]), ['2027']);
  assert.equal(rest.hasYear(sat), false);
});

test('isWeekend 不管调休（调休是 isRest 的活）', () => {
  assert.equal(isWeekend('2026-10-10'), true); // 周六
  assert.equal(rest.isRest('2026-10-10'), false); // 但调休上班
});

test('loadedYears 反映出表里录了哪些年份', () => {
  assert.deepEqual(rest.loadedYears(), ['2026']);
});
