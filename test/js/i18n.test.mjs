// Tests of web/assets/js/util/i18n.js in English, the language outside a
// browser. i18n-de.test.mjs tests German.

import assert from 'node:assert/strict';
import {test} from 'node:test';

import {lang, locale, plural, t} from '../../web/assets/js/util/i18n.js';

test('outside a browser the language is English', () => {
  assert.equal(lang, 'en');
  assert.equal(locale, 'en-GB');
});

test('t returns the English text with its placeholders filled in', () => {
  assert.equal(t('Search'), 'Search');
  assert.equal(
      t('{name}, {when}: skipped', {name: 'Run', when: 'today'}),
      'Run, today: skipped');
});

test('t leaves unknown placeholders as they are', () => {
  assert.equal(t('{a} and {b}', {a: 1}), '1 and {b}');
});

test('plural picks the English form for the count', () => {
  assert.equal(plural(1, '{n} day', '{n} days'), '1 day');
  assert.equal(plural(0, '{n} day', '{n} days'), '0 days');
  assert.equal(plural(2, '{n} day', '{n} days'), '2 days');
});

test('plural formats the count and fills in other placeholders', () => {
  assert.equal(
      plural(1234, '{n} habit in {c}', '{n} habits in {c}', {c: 'Sport'}),
      '1,234 habits in Sport');
});
