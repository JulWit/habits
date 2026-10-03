/**
 * @fileoverview The data page of the settings: export, import (which can be
 * undone right there) and deleting all data.
 */

import {api} from '../data/api.js';
import {refresh} from '../data/loader.js';
import {forget} from '../data/outbox.js';
import {state} from '../data/state.js';
import {undoOnPage} from '../data/undo.js';
import {errorText} from '../ui/toast.js';
import {plural, t} from '../util/i18n.js';
import {ref} from '../vue.js';

import {clearError, reportError, SettingsPage} from './settings-page.js';

/** @import {Ref} from '../vue.js' */

/** Largest import file in MB, as the server's maxImportBytes. */
const MAX_IMPORT_MB = 16;

/**
 * Describes the result of an import.
 * @param {{habits: number, categories: number, skipped: number}} result
 * @return {string}
 */
function importSummary({habits, categories, skipped}) {
  const parts = [plural(habits, '{n} habit imported.', '{n} habits imported.')];
  if (categories > 0) {
    parts.push(
        plural(categories, '{n} category created.', '{n} categories created.'));
  }
  if (skipped > 0) {
    parts.push(plural(
        skipped,
        '{n} habit already existed and was skipped.',
        '{n} habits already existed and were skipped.'));
  }
  return parts.join(' ');
}

/**
 * Offers `text` as a JSON file to save.
 * @param {string} name
 * @param {string} text
 */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked later, as some browsers read the URL after the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The data page. */
export const SettingsDataPage = {
  name: 'SettingsDataPage',
  components: {SettingsPage},
  /** @return {!Object<string, *>} the bindings of the template */
  setup() {
    /** @type {!Ref<?HTMLInputElement>} */
    const importInput = ref(null);
    /** @type {!Ref<?HTMLDialogElement>} */
    const deleteDialog = ref(null);
    const exporting = ref(false);
    const importing = ref(false);
    const deleting = ref(false);
    const importResult = ref('');
    // The undo step of the last import, 0 if there is none to offer.
    const importChange = ref(0);

    /** Downloads an export of the habits. */
    const exportHabits = async () => {
      exporting.value = true;
      try {
        const data = await api.exportHabits();
        download(`habits-${state.today}.json`, JSON.stringify(data, null, 2));
        clearError();
      } catch (err) {
        reportError(errorText(err));
      } finally {
        exporting.value = false;
      }
    };

    /** Imports the chosen file. */
    const importFile = async () => {
      const chooser = importInput.value;
      const file = chooser?.files?.[0];
      if (!chooser || !file) return;
      // Cleared, so that choosing the same file again fires "change".
      chooser.value = '';
      importResult.value = '';
      importChange.value = 0;

      // Checked here, as the server would end the connection during the
      // upload of a larger file, which reads like a lost connection.
      if (file.size > MAX_IMPORT_MB * 1024 * 1024) {
        reportError(
            t('The file is larger than {max} MB.', {max: MAX_IMPORT_MB}));
        return;
      }
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        data = null;
      }
      // An export is a JSON object; anything else is no export at all.
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        reportError(t('The file is not an export of the habits.'));
        return;
      }
      importing.value = true;
      try {
        const counts = await api.importHabits(data);
        clearError();
        importResult.value = importSummary(counts);
        // No step if every habit was skipped.
        importChange.value = counts.changeId ?? 0;
        await refresh();
      } catch (err) {
        const message = errorText(err);
        // The server names the habit or category that is invalid.
        const name = err.params?.habit ?? err.params?.category;
        reportError(name ? t('"{name}": {message}', {name, message}) : message);
      } finally {
        importing.value = false;
      }
    };

    /**
     * Undoes the last import. The page covers the toasts, so it says itself
     * how the undo went.
     */
    const undoImport = async () => {
      const id = importChange.value;
      importChange.value = 0;
      try {
        await undoOnPage(id);
        importResult.value = t('The import was undone.');
      } catch (err) {
        reportError(errorText(err));
      }
    };

    /** Asks before deleting all data; Escape leaves the answer empty. */
    const askToDeleteAll = () => {
      const dialog = deleteDialog.value;
      if (!dialog) return;
      dialog.returnValue = '';
      dialog.showModal();
    };

    /** Deletes all data if the user confirmed it. */
    const deleteAll = async () => {
      if (deleteDialog.value?.returnValue !== 'delete') return;
      deleting.value = true;
      try {
        await api.deleteAllData();
        // Nothing remembered may bring the data back, and the page starts
        // over with the default settings and without undo steps.
        forget();
        location.reload();
      } catch (err) {
        reportError(errorText(err));
        deleting.value = false;
      }
    };

    return {
      importInput,
      deleteDialog,
      exporting,
      importing,
      deleting,
      importResult,
      importChange,
      exportHabits,
      importFile,
      undoImport,
      askToDeleteAll,
      deleteAll,
    };
  },
  template: `
    <settings-page
      id="settings-data"
      :title="t('Data')"
    >
      <div class="field">
        <span class="field-label">{{ t('Export') }}</span>
        <p class="field-hint">
          {{ t('Saves your habits with their schedules and recorded days, and your categories, as a file: a backup that importing restores. Statistics are computed again.') }}
        </p>
        <button
          type="button"
          class="button"
          :disabled="exporting"
          @click="exportHabits"
        >
          <app-icon name="download"/>{{ t('Export habits') }}
        </button>
      </div>
      <div class="field">
        <span class="field-label">{{ t('Import') }}</span>
        <p class="field-hint">
          {{ t('Adds the habits of an exported file with their history. Habits whose name already exists are skipped; categories of the same name are shared.') }}
        </p>
        <input
          ref="importInput"
          type="file"
          accept=".json,application/json"
          hidden
          @change="importFile"
        >
        <button
          type="button"
          class="button"
          :disabled="importing"
          @click="importInput.click()"
        >
          <app-icon name="upload"/>{{ t('Import habits') }}
        </button>
        <p
          v-if="importResult"
          class="field-hint"
          role="status"
        >
          {{ importResult }}
        </p>
        <button
          v-if="importChange"
          type="button"
          class="button"
          data-role="undo-import"
          @click="undoImport"
        >
          {{ t('Undo import') }}
        </button>
      </div>
      <div class="field">
        <span class="field-label">{{ t('Delete') }}</span>
        <p class="field-hint">
          {{ t('Deletes all your habits with their recorded days, your categories and your settings. This cannot be undone; export your habits first to keep them.') }}
        </p>
        <button
          type="button"
          class="button danger"
          :disabled="deleting"
          @click="askToDeleteAll"
        >
          <app-icon name="trash"/>{{ t('Delete all data') }}
        </button>
      </div>
    </settings-page>
    <dialog
      ref="deleteDialog"
      class="dialog compact"
      aria-labelledby="delete-all-title"
      aria-describedby="delete-all-text"
      @close="deleteAll"
    >
      <form method="dialog">
        <h2
          id="delete-all-title"
          class="dialog-head"
        >
          {{ t('Delete all data?') }}
        </h2>
        <p
          id="delete-all-text"
          class="dialog-text"
        >
          {{ t('All habits, recorded days, categories and settings will be deleted for good.') }}
        </p>
        <footer class="dialog-foot">
          <button
            type="submit"
            class="button ghost"
            value="cancel"
          >
            {{ t('Cancel') }}
          </button>
          <button
            type="submit"
            class="button danger"
            value="delete"
          >
            {{ t('Delete') }}
          </button>
        </footer>
      </form>
    </dialog>`,
};
