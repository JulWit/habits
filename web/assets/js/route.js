// The view the URL names, as reactive state: app.js sets it from the hash,
// the views show themselves when it names them.

import {reactive} from './vue.js';

/**
 * The shown view: "board", "habit", "category", "days" or "styleguide", and
 * for a habit or category its ID.
 * @type {{view: string, id: ?string}}
 */
export const route = reactive({view: 'board', id: null});
