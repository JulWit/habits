// Tests of writing a day's entry (web/assets/js/data/actions.js): what a tap
// sends, the order of writes to one day, the outbox, rejections, and writes
// on their way while the state is reloaded.

import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';

import {installFetch, installStorage, KINDS, loadedState, makeHabit, settle, TODAY} from './fixtures.mjs';

const storage = installStorage();
const requests = installFetch();
const actions = await import('../../web/assets/js/data/actions.js');
const outbox = await import('../../web/assets/js/data/outbox.js');
const {habitById, replaceState} =
    await import('../../web/assets/js/data/state.js');
const {entryOn} = await import('../../web/assets/js/data/habit-helpers.js');

/** The day before TODAY, also open in makeHabit's days. */
const YESTERDAY = '2026-10-02';

/**
 * Shows `habit` as the only one, with today as its third day.
 * @param {!Object<string, *>} habit
 */
function show(habit) {
  replaceState({today: TODAY, kinds: KINDS, habits: [habit]});
}

beforeEach(async () => {
  // End what an earlier test left open, and what that sends in turn, so it
  // cannot leak into this one.
  while (requests.length > 0) {
    for (const r of requests.splice(0)) r.respond(500, {detail: 'reset'});
    await settle();
  }
  storage.clear();
  outbox.forget();
  outbox.setOffline(false);
});

test('a tap sets a check and adds a step to a count', async () => {
  show(makeHabit());
  actions.tapEntry('h1', TODAY);
  await settle();
  assert.deepEqual(requests[0].body, {value: 1});

  show(makeHabit({kind: 'count', entries: {[YESTERDAY]: 20}}));
  actions.tapEntry('h1', YESTERDAY);
  await settle();
  assert.equal(requests[1].path, `/api/habits/h1/entries/${YESTERDAY}`);
  assert.deepEqual(requests[1].body, {add: 10});
});

test('writes to one day reach the server one after the other', async () => {
  show(makeHabit({kind: 'count'}));
  actions.tapEntry('h1', TODAY);
  actions.tapEntry('h1', TODAY);
  await settle();
  assert.equal(requests.length, 1);
  // Shown at once, before the server answers.
  assert.deepEqual(
      entryOn(habitById('h1'), TODAY), {value: 20, skipped: false});

  requests[0].respond(200, makeHabit({kind: 'count', entries: {[TODAY]: 10}}));
  await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].body, {add: 10});
});

test('a write without a connection waits in the outbox', async () => {
  show(makeHabit());
  actions.tapEntry('h1', TODAY);
  await settle();
  requests[0].fail();
  await settle();
  assert.deepEqual(outbox.pending(), [{habitId: 'h1', date: TODAY, value: 1}]);
  assert.equal(outbox.isOffline(), true);
  assert.equal(habitById('h1').pending[TODAY].value, 1);
});

test('a rejected write is taken back and the state reloaded', async () => {
  show(makeHabit());
  actions.tapEntry('h1', TODAY);
  await settle();
  requests[0].respond(422, {detail: 'no', code: 'invalid_value'});
  await settle();
  assert.equal(habitById('h1').pending?.[TODAY], undefined);
  assert.deepEqual(outbox.pending(), []);
  assert.equal(requests[1].path, '/api/state');
});

test(
    'a write is announced once: by its toast, or else by the board',
    async () => {
      show(makeHabit());
      actions.tapEntry('h1', TODAY);
      await settle();
      requests[0].respond(200, makeHabit({entries: {[TODAY]: 1}}));
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(actions.announcement.value, 'Water, today: 1×');

      // Clearing the day offers to undo it in a toast.
      actions.announcement.value = '';
      actions.tapEntry('h1', TODAY);
      await settle();
      requests[1].respond(200, makeHabit());
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(actions.announcement.value, '');
    });

test('a write on its way stays shown when a reload lacks it', async () => {
  show(makeHabit());
  actions.tapEntry('h1', TODAY);
  await settle();
  const loaded = actions.keepInFlight(loadedState([makeHabit()]));
  assert.deepEqual(loaded.habits[0].pending, {
    [TODAY]: {value: 1, skipped: false},
  });

  requests[0].respond(200, makeHabit({entries: {[TODAY]: 1}, days: 'ooc'}));
  await settle();
  const later = actions.keepInFlight(loadedState([makeHabit()]));
  assert.equal(later.habits[0].pending, undefined);
});
