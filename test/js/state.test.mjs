// Tests of web/assets/js/data/state.js and of laying waiting writes over a
// state (outbox.js): habits and categories are frozen and replaced, never
// changed in place.

import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';

import {installStorage, makeHabit, TODAY} from './fixtures.mjs';

installStorage();
const {applied} = await import('../../web/assets/js/data/actions.js');
const {enqueue, overlay} = await import('../../web/assets/js/data/outbox.js');
const stateModule = await import('../../web/assets/js/data/state.js');
const {
  applyEntryAnswer,
  boardBlocks,
  groupedHabits,
  habitById,
  inOrder,
  replaceState,
  showPending,
  state,
  stateRevision,
  upsertHabit,
} = stateModule;

beforeEach(() => {
  localStorage.clear();
  replaceState({
    today: TODAY,
    settings: {showArchived: false},
    categories: [],
    habits: [],
  });
});

test('loaded habits and categories are frozen', () => {
  replaceState({
    habits: [makeHabit()],
    categories: [{id: 'c1', name: 'Sport', position: 0}],
  });
  assert.ok(Object.isFrozen(state.habits[0]));
  assert.ok(Object.isFrozen(state.categories[0]));
  assert.throws(() => {
    state.habits[0].name = 'changed';
  }, TypeError);
});

test('a change replaces the habit and counts as a change of the state', () => {
  replaceState({habits: [makeHabit()]});
  const before = habitById('h1');
  const revision = stateRevision();
  showPending('h1', '2026-10-02', {value: 1, skipped: false});
  const after = habitById('h1');
  assert.notEqual(after, before);
  assert.ok(Object.isFrozen(after));
  assert.equal(before.pending, undefined);
  assert.deepEqual(after.pending, {'2026-10-02': {value: 1, skipped: false}});
  assert.equal(stateRevision(), revision + 1);
});

test('the answer to a write ends only its own pending day', () => {
  replaceState({habits: [makeHabit()]});
  showPending('h1', '2026-10-01', {value: 1, skipped: false});
  showPending('h1', '2026-10-02', {value: 1, skipped: false});
  applyEntryAnswer('2026-10-01', makeHabit({days: 'coo'}));
  const habit = habitById('h1');
  assert.equal(habit.days, 'coo');
  assert.deepEqual(Object.keys(habit.pending), ['2026-10-02']);
});

test('upsertHabit merges a view into the habit', () => {
  replaceState({habits: [makeHabit()]});
  upsertHabit({id: 'h1', name: 'Tea'});
  assert.equal(habitById('h1').name, 'Tea');
  assert.equal(habitById('h1').kind, 'check');
  upsertHabit(makeHabit({id: 'h2'}));
  assert.equal(state.habits.length, 2);
  assert.ok(Object.isFrozen(habitById('h2')));
});

test('inOrder sorts by the IDs and copies only what moved', () => {
  const items = [
    Object.freeze({id: 'a', position: 0}),
    Object.freeze({id: 'b', position: 1}),
    Object.freeze({id: 'c', position: 2}),
  ];
  const sorted = inOrder(items, ['b', 'a']);
  assert.deepEqual(
      sorted.map((i) => [i.id, i.position]), [['b', 0], ['a', 1], ['c', 2]]);
  // c kept its place, and so its object.
  assert.equal(sorted[2], items[2]);
  assert.ok(sorted.every(Object.isFrozen));
});

test('groupedHabits groups by category, the rest last', () => {
  replaceState({
    categories: [{id: 'c1', name: 'Sport', position: 0}],
    habits: [
      makeHabit({id: 'a'}),
      makeHabit({id: 'b', categoryId: 'c1'}),
      makeHabit({id: 'c', categoryId: 'gone'}),
      makeHabit({id: 'd', archivedAt: '2026-09-01T00:00:00Z'}),
    ],
  });
  const blocks = groupedHabits();
  assert.deepEqual(
      blocks.map((b) => [b.category?.id ?? null, b.habits.map((h) => h.id)]),
      [['c1', ['b']], [null, ['a', 'c']]]);
  const all = groupedHabits({archived: true});
  assert.deepEqual(all[1].habits.map((h) => h.id), ['a', 'c', 'd']);
});

test('boardBlocks lists all habits in their order unless grouped', () => {
  const categories = [{id: 'c1', name: 'Sport', position: 0}];
  const habits = [
    makeHabit({id: 'a'}),
    makeHabit({id: 'b', categoryId: 'c1'}),
    makeHabit({id: 'c', archivedAt: '2026-09-01T00:00:00Z'}),
  ];
  replaceState({settings: {showArchived: false}, categories, habits});
  assert.deepEqual(boardBlocks(), groupedHabits());

  replaceState({
    settings: {showArchived: false, groupByCategory: false},
    categories,
    habits,
  });
  assert.deepEqual(
      boardBlocks().map((b) => [b.category, b.habits.map((h) => h.id)]),
      [[null, ['a', 'b']]]);

  replaceState({
    settings: {showArchived: false, groupByCategory: false},
    categories,
    habits: [],
  });
  assert.deepEqual(boardBlocks(), []);
});

test('overlay copies the habits with waiting writes', () => {
  replaceState(
      {user: {id: 'u1'}, habits: [makeHabit(), makeHabit({id: 'h2'})]});
  enqueue('h1', '2026-10-02', 1);
  const shown = overlay({habits: [...state.habits]});
  // The frozen habits of the state are left as they are.
  assert.equal(habitById('h1').pending, undefined);
  assert.deepEqual(
      shown.habits[0].pending, {'2026-10-02': {value: 1, skipped: false}});
  assert.equal(shown.habits[1], habitById('h2'));
});

test('applied shows a change of an entry', () => {
  const entry = {value: 3, skipped: false};
  assert.deepEqual(applied(entry, {value: 5}), {value: 5, skipped: false});
  assert.deepEqual(applied(entry, {skipped: true}), {value: 0, skipped: true});
  assert.deepEqual(
      applied({value: 0, skipped: true}, {value: 2}),
      {value: 2, skipped: false});
});
