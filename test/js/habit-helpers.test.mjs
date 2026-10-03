// Tests of web/assets/js/data/habit-helpers.js: reading the server's day
// statuses and formatting values, in English.

import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';

import * as helpers from '../../web/assets/js/data/habit-helpers.js';
import {replaceState} from '../../web/assets/js/data/state.js';

import {KINDS, makeHabit, TODAY} from './fixtures.mjs';

beforeEach(() => {
  replaceState({kinds: KINDS, today: TODAY, habits: [], categories: []});
});

test('statuses are read from the days the server sent', () => {
  // From 1 October: open, done, skipped, free, bonus, over, before the start.
  const habit = makeHabit({daysFrom: '2026-10-01', days: 'ocsfbx<'});
  assert.ok(helpers.isDue(habit, '2026-10-01'));
  assert.ok(!helpers.isDone(habit, '2026-10-01'));
  assert.ok(helpers.isDone(habit, '2026-10-02'));
  assert.ok(helpers.isSkipped(habit, '2026-10-03'));
  assert.ok(helpers.isFree(habit, '2026-10-04'));
  assert.ok(helpers.isBonus(habit, '2026-10-05'));
  assert.ok(helpers.isDone(habit, '2026-10-05'));
  assert.ok(helpers.isOver(habit, '2026-10-06'));
  assert.ok(helpers.isBeforeStart(habit, '2026-10-07'));
});

test('days outside the sent range are not due', () => {
  const habit = makeHabit({daysFrom: '2026-10-01', days: 'ooo'});
  assert.ok(!helpers.isScheduled(habit, '2026-09-30'));
  assert.ok(!helpers.isScheduled(habit, '2026-10-04'));
  assert.ok(helpers.isScheduled(habit, '2026-10-02'));
});

test('a pending write is shown instead of the stored entry', () => {
  const habit = makeHabit({
    entries: {'2026-10-02': 1},
    pending: {'2026-10-02': {value: 0, skipped: false}},
  });
  assert.deepEqual(
      helpers.entryOn(habit, '2026-10-02'), {value: 0, skipped: false});
  assert.ok(helpers.isPending(habit, '2026-10-02'));
  assert.ok(!helpers.isPending(habit, '2026-10-01'));
});

test('nextValue toggles a check and steps a count up to its maximum', () => {
  const check = makeHabit();
  assert.equal(helpers.nextValue(check, 0), 1);
  assert.equal(helpers.nextValue(check, 1), 0);

  const count = makeHabit({kind: 'count'});
  assert.equal(helpers.nextValue(count, 0), 10);
  assert.equal(helpers.nextValue(count, 9995), 10000);
  const ownStep = makeHabit({kind: 'count', stepValue: 25});
  assert.equal(helpers.nextValue(ownStep, 10), 35);
});

test('formatValue writes the unit of the kind', () => {
  assert.equal(helpers.formatValue(makeHabit({kind: 'time'}), 155), '15.5 min');
  assert.equal(
      helpers.formatValue(makeHabit({kind: 'distance'}), 800), '800 m');
  // Kilometres are rounded down, so a value short of a target never reads as
  // reaching it.
  assert.equal(
      helpers.formatValue(makeHabit({kind: 'distance'}), 4999), '4.9 km');
  assert.equal(
      helpers.formatValue(makeHabit({kind: 'count', unit: 'glasses'}), 30),
      '3 glasses');
  assert.equal(helpers.formatValue(makeHabit({kind: 'count'}), 30), '3×');
});

test('cellValue fits at most three digits', () => {
  const count = makeHabit({kind: 'count'});
  assert.equal(helpers.cellValue(count, 25), '2.5');
  assert.equal(helpers.cellValue(count, 1234), '123');
  assert.equal(helpers.cellValue(count, 15000), '1.5k');
  assert.equal(helpers.cellValue(makeHabit({kind: 'time'}), 14400), '24h');
  assert.equal(helpers.cellValue(makeHabit({kind: 'distance'}), 4999), '4.9');
});

test('formatTotal shows hours of an hour or more', () => {
  const time = makeHabit({kind: 'time'});
  assert.equal(helpers.formatTotal(time, 450), '45 min');
  assert.equal(helpers.formatTotal(time, 2250), '3 h 45 min');
});

test('describeFrequency', () => {
  const frequency = makeHabit().schedules[0].frequency;
  assert.equal(helpers.describeFrequency(frequency), 'daily');
  assert.equal(
      helpers.describeFrequency(
          {...frequency, kind: 'times_per_week', timesPerWeek: 3}),
      '3× per week');
  assert.equal(
      helpers.describeFrequency(
          {...frequency, kind: 'weekdays', weekdays: 0b11111}),
      'Mon–Fri');
  assert.equal(
      helpers.describeFrequency(
          {...frequency, kind: 'weekdays', weekdays: 0b101, weekOfMonth: -1}),
      'last Mon, Wed of the month');
  assert.equal(
      helpers.describeFrequency({
        ...frequency,
        kind: 'custom_interval',
        intervalDays: 3,
        anchorDate: '2026-09-01',
      }),
      'every 3 days from 1 Sep');
});

test('describeTarget names a limit', () => {
  const coffee = makeHabit({kind: 'count', unit: 'cups'});
  const schedule = {...coffee.schedules[0], targetType: 'at_most'};
  assert.equal(
      helpers.describeTarget(coffee, {...schedule, targetValue: 20}),
      'at most 2 cups');
  assert.equal(
      helpers.describeTarget(coffee, {...schedule, targetValue: 0}),
      'none at all');
});

test('the schedule of a day is the last one that started by then', () => {
  const habit = makeHabit({kind: 'count'});
  habit.schedules = [
    {...habit.schedules[0], targetValue: 10},
    {...habit.schedules[0], from: '2026-06-01', targetValue: 50},
  ];
  assert.equal(helpers.target(habit, '2025-12-01'), 10);
  assert.equal(helpers.target(habit, '2026-05-31'), 10);
  assert.equal(helpers.target(habit, '2026-06-01'), 50);
  assert.equal(helpers.progress(habit, '2026-06-01', 25), 0.5);
});

test('streak levels and the days of a run', () => {
  assert.equal(helpers.streakLevel(6), 0);
  assert.equal(helpers.streakLevel(7), 1);
  assert.equal(helpers.streakLevel(365), 6);
  const habit =
      makeHabit({streakRuns: [{from: '2026-09-28', to: '2026-10-02'}]});
  assert.equal(helpers.streakDaysOn(habit, '2026-09-28'), 1);
  assert.equal(helpers.streakDaysOn(habit, '2026-10-02'), 5);
  assert.equal(helpers.streakDaysOn(habit, '2026-10-03'), 0);
});
