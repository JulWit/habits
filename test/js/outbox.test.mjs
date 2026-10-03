// Tests of web/assets/js/data/outbox.js: the writes waiting on the device.

import assert from 'node:assert/strict';
import {beforeEach, test} from 'node:test';

import {installStorage} from './fixtures.mjs';

const storage = installStorage();
const outbox = await import('../../web/assets/js/data/outbox.js');

beforeEach(() => {
  storage.clear();
  outbox.forget();
  outbox.rememberState({user: {id: 'u1'}, habits: []});
  outbox.setOffline(false);
});

test('a newer write to the same day replaces the older one', () => {
  outbox.enqueue('h1', '2026-10-01', 1);
  outbox.enqueue('h2', '2026-10-01', 2);
  outbox.enqueue('h1', '2026-10-01', 3);
  assert.deepEqual(outbox.pending(), [
    {habitId: 'h2', date: '2026-10-01', value: 2},
    {habitId: 'h1', date: '2026-10-01', value: 3},
  ]);
});

test('the waiting writes are kept per user', () => {
  outbox.enqueue('h1', '2026-10-01', 1);
  outbox.rememberState({user: {id: 'u2'}, habits: []});
  assert.deepEqual(outbox.pending(), []);
  outbox.rememberState({user: {id: 'u1'}, habits: []});
  assert.equal(outbox.pending().length, 1);
});

test('pending returns a copy', () => {
  outbox.enqueue('h1', '2026-10-01', 1);
  outbox.pending().pop();
  assert.equal(outbox.pending().length, 1);
});

test('discard with a value keeps a newer write', () => {
  outbox.enqueue('h1', '2026-10-01', 2);
  outbox.discard('h1', '2026-10-01', 1);
  assert.equal(outbox.pending().length, 1);
  outbox.discard('h1', '2026-10-01', 2);
  assert.equal(outbox.pending().length, 0);
});

test('flush sends in order and stops at a lost connection', async () => {
  outbox.enqueue('h1', '2026-10-01', 1);
  outbox.enqueue('h2', '2026-10-01', 2);
  outbox.enqueue('h3', '2026-10-01', 3);
  const sent = [];
  const rejected = [];
  const n = await outbox.flush(async (habitId) => {
    if (habitId === 'h2') throw {code: 'rejected'};
    if (habitId === 'h3') throw {code: 'offline'};
    sent.push(habitId);
  }, (err, write) => rejected.push(write.habitId));
  assert.equal(n, 1);
  assert.deepEqual(sent, ['h1']);
  // A rejected write is dropped, one that could not be sent stays.
  assert.deepEqual(rejected, ['h2']);
  assert.deepEqual(outbox.pending().map((w) => w.habitId), ['h3']);
  assert.ok(outbox.isOffline());
});

test('a second flush joins the running one', async () => {
  outbox.enqueue('h1', '2026-10-01', 1);
  let calls = 0;
  const send = async () => {
    calls++;
  };
  const [a, b] = await Promise.all(
      [outbox.flush(send, () => {}), outbox.flush(send, () => {})]);
  assert.equal(calls, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('statusText counts the waiting writes', () => {
  assert.equal(outbox.statusText(), '');
  outbox.setOffline(true);
  assert.equal(outbox.statusText(), 'Offline');
  outbox.enqueue('h1', '2026-10-01', 1);
  assert.equal(outbox.statusText(), '1 change waiting');
  outbox.enqueue('h1', '2026-10-02', 1);
  assert.equal(outbox.statusText(), '2 changes waiting');
});
