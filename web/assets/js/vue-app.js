// Creates the Vue app with what every template may use: the icon components
// and t() for the UI texts.

import {t} from './i18n.js';
import {AppIcon, IconBadge} from './icons.js';
import {createApp} from './vue.js';

/**
 * Creates a Vue app of `root` with the shared components and helpers.
 * @param {!Object} root the root component
 * @param {?Object=} props the props of the root component
 * @return {!Object} the app, not yet mounted
 */
export function createVueApp(root, props = null) {
  const app = createApp(root, props);
  app.component('AppIcon', AppIcon);
  app.component('IconBadge', IconBadge);
  app.config.globalProperties.t = t;
  return app;
}
