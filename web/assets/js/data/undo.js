/**
 * @fileoverview Undo and redo. The server keeps the undo steps: every change
 * that can be undone answers with the ID of its step (changeId, see api.js),
 * and undo and redo ask the server to turn a step, or the latest one. The
 * toasts offer them (see toast.js).
 */

import {errorText, toast} from '../ui/toast.js';
import {formatRelative} from '../util/dates.js';
import {locale, t} from '../util/i18n.js';

import {api} from './api.js';
import {refresh} from './loader.js';
import {state} from './state.js';

/**
 * Shows `text` in a toast with a button that undoes the step `changeId`. A
 * change without a step (e.g. one waiting offline) shows the text only.
 * @param {number|undefined} changeId
 * @param {string} text
 */
export function offerUndo(changeId, text) {
  if (!changeId) {
    toast(text);
    return;
  }
  toast(text, {actionLabel: t('Undo'), onAction: () => undoStep(changeId)});
}

/**
 * Undoes the latest step, e.g. for Ctrl+Z.
 * @return {!Promise<void>}
 */
export function undoLast() {
  return undoStep(0);
}

/**
 * Redoes the step undone last, e.g. for Ctrl+Y.
 * @return {!Promise<void>}
 */
export function redoLast() {
  return redoStep(0);
}

/**
 * Undoes the step `id` for a page, which covers the toasts and shows the
 * outcome itself: without a toast, throwing the error. The state is reloaded
 * either way, as a step whose data was changed since is dropped.
 * @param {number} id
 * @return {!Promise<void>}
 */
export async function undoOnPage(id) {
  try {
    await api.undo(id);
  } finally {
    await refresh();
  }
}

/**
 * Undoes the step `id` (0 for the latest) and offers to redo it.
 * @param {number} id
 * @return {!Promise<void>}
 */
async function undoStep(id) {
  try {
    const step = await api.undo(id);
    await refresh();
    toast(t('Undone: {label}', {label: stepLabel(step)}), {
      actionLabel: t('Redo'),
      onAction: () => redoStep(step.id),
    });
  } catch (err) {
    await failed(err);
  }
}

/**
 * Redoes the step `id` (0 for the one undone last) and offers to undo it.
 * @param {number} id
 * @return {!Promise<void>}
 */
async function redoStep(id) {
  try {
    const step = await api.redo(id);
    await refresh();
    toast(t('Redone: {label}', {label: stepLabel(step)}), {
      actionLabel: t('Undo'),
      onAction: () => undoStep(step.id),
    });
  } catch (err) {
    await failed(err);
  }
}

/**
 * Shows why a step could not be turned. If the data was changed elsewhere
 * meanwhile (409), the server has dropped the step and the state is reloaded.
 * @param {*} err
 * @return {!Promise<void>}
 */
async function failed(err) {
  toast(errorText(err), {error: true});
  if (err?.status === 409) await refresh();
}

/**
 * Returns the label of a step in the UI language: its English template,
 * translated like any text, with its parameters; a date is shown relative to
 * today.
 * @param {{label: string, params: ?Object<string, *>}} step
 * @return {string}
 */
export function stepLabel(step) {
  const vars = {};
  for (const [name, value] of Object.entries(step.params ?? {})) {
    if (name === 'date') {
      vars[name] = formatRelative(value, state.today);
    } else if (typeof value === 'number') {
      vars[name] = value.toLocaleString(locale);
    } else {
      vars[name] = value;
    }
  }
  return t(step.label, vars);
}
