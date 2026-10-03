// Tests of web/assets/js/util/i18n.js in German. The language is read from
// <html lang> when the module loads, so this file stands in a document before
// importing it; node --test runs every file in a process of its own.

import assert from 'node:assert/strict';
import {test} from 'node:test';

globalThis.document = {
  documentElement: {lang: 'de'},
};
const {errorTemplate, lang, locale, plural, t} =
    await import('../../web/assets/js/util/i18n.js');

test('<html lang="de"> selects German', () => {
  assert.equal(lang, 'de');
  assert.equal(locale, 'de-DE');
});

test('t translates and keeps unknown texts', () => {
  assert.equal(t('Search'), 'Suche');
  assert.equal(t('No such text'), 'No such text');
});

test('t picks the variant of a context', () => {
  assert.equal(t('Archive', {context: 'verb'}), 'Archivieren');
});

test('plural picks the German form by the count', () => {
  assert.equal(plural(1, '{n} day', '{n} days'), '1 Tag');
  assert.equal(plural(2, '{n} day', '{n} days'), '2 Tage');
  assert.equal(plural(0, '{n} day', '{n} days'), '0 Tage');
  assert.equal(plural(1500, '{n} day', '{n} days'), '1.500 Tage');
});

test(
    'a count already formatted, as in an undo label, picks the form too',
    () => {
      assert.equal(t('{n} days skipped', {n: '1'}), '1 Tag übersprungen');
      assert.equal(t('{n} days skipped', {n: '3'}), '3 Tage übersprungen');
      assert.equal(
          t('{n} days skipped', {n: '1.234'}), '1.234 Tage übersprungen');
    });

test('the singular undo labels of the server stay translated', () => {
  assert.equal(t('1 day skipped'), '1 Tag übersprungen');
  assert.equal(t('1 habit imported'), '1 Gewohnheit importiert');
});

test('problem codes have German templates', () => {
  assert.equal(typeof errorTemplate('import_format'), 'string');
  assert.equal(errorTemplate('no_such_code'), undefined);
});
