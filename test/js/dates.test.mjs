// Tests of web/assets/js/util/dates.js. Outside a browser the UI language is
// English (see i18n.js).

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {addDays, dayOfMonth, daysBetween, formatDayMonth, formatFull, formatLong, formatRelative, localISO, monthIndex, startOfWeek, weekdayIndex, yearOf} from '../../web/assets/js/util/dates.js';

test('addDays crosses months, years and leap days', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-03-10', -10), '2026-02-28');
});

test('daysBetween counts whole days, negative backwards', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0);
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.equal(daysBetween('2026-03-31', '2026-03-28'), -3);
  // The change to summer time in Europe is no shorter day.
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
});

test('weeks start on Monday', () => {
  // 2026-10-05 is a Monday, 2026-10-11 a Sunday.
  assert.equal(weekdayIndex('2026-10-05'), 0);
  assert.equal(weekdayIndex('2026-10-11'), 6);
  assert.equal(startOfWeek('2026-10-11'), '2026-10-05');
  assert.equal(startOfWeek('2026-10-05'), '2026-10-05');
});

test('the parts of a date', () => {
  assert.equal(dayOfMonth('2026-09-07'), 7);
  assert.equal(monthIndex('2026-09-07'), 8);
  assert.equal(yearOf('2026-09-07'), 2026);
});

test('dates are formatted in English', () => {
  assert.equal(formatDayMonth('2026-09-13'), '13 Sep');
  assert.equal(formatLong('2026-09-13'), 'Sun, 13 Sep 2026');
  assert.equal(formatFull('2026-01-01'), 'Thursday, 1 January 2026');
  assert.equal(formatFull('2026-01-01', false), 'Thursday, 1 January');
});

test('formatRelative names the days around today', () => {
  const today = '2026-10-03';
  assert.equal(formatRelative(today, today), 'today');
  assert.equal(formatRelative('2026-10-02', today), 'yesterday');
  assert.equal(formatRelative('2026-10-01', today), 'the day before yesterday');
  assert.equal(formatRelative('2026-10-04', today), 'tomorrow');
  assert.equal(formatRelative('2026-10-05', today), 'the day after tomorrow');
  assert.equal(formatRelative('2026-09-30', today), 'Wed, 30 Sep 2026');
});

test('localISO takes the day in the given time zone', () => {
  const stamp = '2026-10-03T23:30:00Z';
  assert.equal(localISO(stamp, 'UTC'), '2026-10-03');
  assert.equal(localISO(stamp, 'Europe/Berlin'), '2026-10-04');
  assert.equal(localISO(stamp, 'America/New_York'), '2026-10-03');
});
