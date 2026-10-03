// Tests of web/assets/js/data/loader.js: one load of the state at a time.

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {installFetch, installStorage, loadedState, makeHabit, settle} from './fixtures.mjs';

installStorage();
const requests = installFetch();
const {refresh} = await import('../../web/assets/js/data/loader.js');
const {state} = await import('../../web/assets/js/data/state.js');

test('refreshes asked for during a load share one more load', async () => {
  let done = 0;
  const first = refresh().then(() => done++);
  await settle();
  assert.equal(requests.length, 1);

  // Both may have changed something the running load missed.
  const second = refresh().then(() => done++);
  const third = refresh().then(() => done++);
  requests[0].respond(200, loadedState([makeHabit({name: 'Old'})]));
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(done, 0);

  requests[1].respond(200, loadedState([makeHabit({name: 'New'})]));
  await Promise.all([first, second, third]);
  assert.equal(done, 3);
  assert.equal(requests.length, 2);
  assert.equal(state.habits[0].name, 'New');
});
