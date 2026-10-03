// Every UI text the frontend passes to t() or plural() has a German
// translation in DE of web/assets/js/util/i18n.js, keyed by the English text
// (for plural(), by its form for other counts). Texts that are not literals,
// such as the labels of the server's options, are not checked here.

import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const JS = fileURLToPath(new URL('../../web/assets/js/', import.meta.url));

/** A JS string literal in single or double quotes; group 1 or 2. */
const STRING = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;

/**
 * Returns the paths of the frontend's modules, without Vue.
 * @param {string} dir
 * @return {!Array<string>}
 */
function modules(dir) {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modules(path);
    return entry.name.endsWith('.js') && entry.name !== 'vue.js' ? [path] : [];
  });
}

/**
 * Returns the text of a matched string literal, unescaped.
 * @param {string|undefined} single
 * @param {string|undefined} double
 * @return {string}
 */
function literal(single, double) {
  return (single ?? double).replace(/\\(.)/g, '$1');
}

/**
 * Returns the keys of the German translations.
 * @return {!Set<string>}
 */
function germanKeys() {
  const source = readFileSync(join(JS, 'util', 'i18n.js'), 'utf-8');
  const de = source.slice(
      source.indexOf('const DE = {'), source.indexOf('const DE_ERRORS'));
  const keys = new Set();
  for (const match of de.matchAll(new RegExp(`^  ${STRING}:`, 'gm'))) {
    keys.add(literal(match[1], match[2]));
  }
  return keys;
}

/**
 * Returns the texts the frontend translates, with the module that uses each.
 * @return {!Map<string, string>}
 */
function usedTexts() {
  const used = new Map();
  const call =
      new RegExp(String.raw`\bt\(\s*${STRING}(\s*,\s*\{[^}]*\})?`, 'g');
  const plural = new RegExp(
      String.raw`\bplural\(\s*[^,]+,\s*${STRING}\s*,\s*${STRING}`, 'g');
  for (const path of modules(JS)) {
    if (path.endsWith(join('util', 'i18n.js'))) continue;
    const source = readFileSync(path, 'utf-8');
    for (const match of source.matchAll(call)) {
      const text = literal(match[1], match[2]);
      const context = /context:\s*'(\w+)'/.exec(match[3] ?? '')?.[1];
      used.set(context ? `${context}|${text}` : text, path);
    }
    for (const match of source.matchAll(plural)) {
      used.set(literal(match[3], match[4]), path);
    }
  }
  return used;
}

test('every translated text has a German translation', () => {
  const keys = germanKeys();
  const missing = [...usedTexts()]
                      .filter(([text]) => !keys.has(text))
                      .map(([text, path]) => `${text}  (${path})`);
  assert.deepEqual(missing, []);
});

test('the check finds the texts', () => {
  // Guards the regular expressions above against finding nothing.
  assert.ok(usedTexts().size > 300);
  assert.ok(germanKeys().size > 300);
});
