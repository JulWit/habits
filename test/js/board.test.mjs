// Tests of the overview's window of days (views/board-window.js) and of how
// many columns fit (views/board-measure.js).

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {installStorage} from './fixtures.mjs';

installStorage();
const {monthLabels, pageStep, windowStart} =
    await import('../../web/assets/js/views/board-window.js');
const {layoutFor} = await import('../../web/assets/js/views/board-measure.js');

test('the window ends on today, or as many days before', () => {
  // 2026-10-03 is a Saturday.
  assert.equal(windowStart('2026-10-03', 7, 0, false), '2026-09-27');
  assert.equal(windowStart('2026-10-03', 7, 7, false), '2026-09-20');
  assert.equal(windowStart('2026-10-03', 7, -7, false), '2026-10-04');
});

test('aligned to weeks, the window starts on a Monday', () => {
  assert.equal(windowStart('2026-10-03', 14, 0, true), '2026-09-21');
  assert.equal(windowStart('2026-10-03', 10, 0, true), '2026-09-28');
  // Fewer than seven columns are not aligned.
  assert.equal(windowStart('2026-10-03', 5, 0, true), '2026-09-29');
});

test('paging moves by whole weeks when aligned', () => {
  assert.equal(pageStep(10, false), 10);
  assert.equal(pageStep(10, true), 7);
  assert.equal(pageStep(21, true), 21);
  assert.equal(pageStep(5, true), 5);
});

test('month labels span their columns', () => {
  const dates = [
    '2026-09-29',
    '2026-09-30',
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
  ];
  const labels = monthLabels(dates, '2026-10-03');
  assert.deepEqual(labels.map((l) => [l.name, l.column, l.narrow]), [
    ['Sep', '2 / span 2', true],
    ['October', '4 / span 5', false],
  ]);
});

test('month labels of another year name it', () => {
  const labels = monthLabels(['2025-12-31', '2026-01-01'], '2026-10-03');
  assert.deepEqual(labels.map((l) => l.name), ['Dec 2025', 'Jan']);
});

/** Size tokens as the stylesheet has them at normal density. */
const TOKENS = {
  cell: 40,
  labelMin: 148,
  padX: 12,
  tools: 0,
  cellTightMin: 28,
  labelTightMin: 96,
};

test('a wide window shows as many days as fit, or the setting', () => {
  const wide = layoutFor(1200, 0, TOKENS);
  assert.equal(wide.mode, 'normal');
  // (1200 - 26 - 148) / 42
  assert.equal(wide.days, 24);
  assert.equal(layoutFor(1200, 14, TOKENS).days, 14);
});

test('a narrow window shows a week, stacked if the days stay large', () => {
  const phone = layoutFor(400, 0, TOKENS);
  assert.equal(phone.days, 7);
  assert.equal(phone.mode, 'stacked');
  assert.equal(phone.label, 0);
  assert.ok(phone.cell >= TOKENS.cell && phone.cell <= 48);
});

test('narrower still, the board is tight', () => {
  const narrow = layoutFor(280, 0, TOKENS);
  assert.equal(narrow.days, 7);
  assert.equal(narrow.mode, 'tight');
  assert.ok(narrow.cell >= TOKENS.cellTightMin);
});

test('a fixed setting below a week is kept', () => {
  const layout = layoutFor(320, 5, TOKENS);
  assert.equal(layout.days, 5);
});
