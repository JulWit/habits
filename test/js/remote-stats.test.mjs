// Tests of useRemote (web/assets/js/data/remote-stats.js): what a view loads,
// when it loads again, and that a replaced request is aborted.

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {installStorage} from './fixtures.mjs';

installStorage();
const {useRemote} = await import('../../web/assets/js/data/remote-stats.js');
const {replaceState} = await import('../../web/assets/js/data/state.js');
const {effectScope, nextTick, ref} = await import('../../web/assets/js/vue.js');

/**
 * Waits until the promises queued so far have settled.
 * @return {!Promise<void>}
 */
async function settle() {
  for (let i = 0; i < 5; i++) await nextTick();
}

/**
 * Returns a load function that resolves each call by hand, and its calls.
 * @return {{load: function(!AbortSignal): !Promise<*>, calls: !Array<*>}}
 */
function manualLoad() {
  const calls = [];
  const load = (signal) => new Promise((resolve, reject) => {
    calls.push({resolve, signal});
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  return {load, calls};
}

test('loads the answer for the key, and nothing for null', async () => {
  const key = ref(null);
  const {load, calls} = manualLoad();
  const scope = effectScope();
  const remote = scope.run(() => useRemote(() => key.value, load));
  assert.equal(calls.length, 0);

  key.value = 'test|a';
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(remote.loading.value, true);
  calls[0].resolve({n: 1});
  await settle();
  assert.deepEqual(remote.data.value, {n: 1});
  assert.equal(remote.loading.value, false);
  scope.stop();
});

test('a new key aborts the request of the old one', async () => {
  const key = ref('test|b1');
  const {load, calls} = manualLoad();
  const scope = effectScope();
  const remote = scope.run(() => useRemote(() => key.value, load));
  key.value = 'test|b2';
  await settle();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].signal.aborted);
  calls[1].resolve('b2');
  await settle();
  assert.equal(remote.data.value, 'b2');
  scope.stop();
});

test(
    'a change of the state loads again, keeping the answer meanwhile',
    async () => {
      const {load, calls} = manualLoad();
      const scope = effectScope();
      const remote = scope.run(() => useRemote(() => 'test|c', load));
      calls[0].resolve('first');
      await settle();
      replaceState({today: '2026-10-04'});
      await settle();
      assert.equal(calls.length, 2);
      assert.equal(remote.data.value, 'first');
      calls[1].resolve('second');
      await settle();
      assert.equal(remote.data.value, 'second');
      scope.stop();
    });

test('a kept answer is shown at once and not loaded again', async () => {
  const key = ref('test|d1');
  const {load, calls} = manualLoad();
  const scope = effectScope();
  const remote = scope.run(() => useRemote(() => key.value, load));
  calls[0].resolve('d1');
  await settle();
  key.value = 'test|d2';
  await settle();
  // Without `keep`, nothing is shown while another key loads.
  assert.equal(remote.data.value, undefined);
  calls[1].resolve('d2');
  await settle();
  key.value = 'test|d1';
  await settle();
  assert.equal(remote.data.value, 'd1');
  assert.equal(calls.length, 2);
  scope.stop();
});

test('keep shows the previous answer while another key loads', async () => {
  const key = ref('test|e1');
  const {load, calls} = manualLoad();
  const scope = effectScope();
  const remote =
      scope.run(() => useRemote(() => key.value, load, {keep: () => true}));
  calls[0].resolve('e1');
  await settle();
  key.value = 'test|e2';
  await settle();
  assert.equal(remote.data.value, 'e1');
  scope.stop();
});

test('stopping the scope aborts the running request', async () => {
  const {load, calls} = manualLoad();
  const scope = effectScope();
  scope.run(() => useRemote(() => 'test|f', load));
  scope.stop();
  assert.ok(calls[0].signal.aborted);
});

test(
    'an answer arriving after its abort does not replace a kept one',
    async () => {
      const key = ref('test|g1');
      const calls = [];
      // Resolves even after an abort, as a request whose body was read.
      const load = (signal) => new Promise((resolve) => {
        calls.push({resolve, signal});
      });
      const scope = effectScope();
      const remote = scope.run(() => useRemote(() => key.value, load));
      calls[0].resolve('g1');
      await settle();
      key.value = 'test|g2';
      await settle();
      key.value = 'test|g1';
      await settle();
      assert.equal(remote.data.value, 'g1');
      assert.ok(calls[1].signal.aborted);
      calls[1].resolve('g2');
      await settle();
      assert.equal(remote.data.value, 'g1');
      scope.stop();
    });
