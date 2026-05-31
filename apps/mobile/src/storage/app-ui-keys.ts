/**
 * KKV keys for mobile UI preferences (module `nm-mobile-ui`).
 *
 * @module storage/app-ui-keys
 */

/** KKV module name for app-only UI settings (never Core workspace modules). */
export const APP_UI_KKV_MODULE = 'nm-mobile-ui';

export const APP_UI_KEY_THEME = 'theme';
export const APP_UI_KEY_CHECKPOINT_RETENTION = 'checkpointRetention';
export const APP_UI_KEY_SHOW_FULL_TOOL_PARAMS = 'showFullToolParams';

/** Default string values when a key is missing. */
export const APP_UI_DEFAULTS = {
  [APP_UI_KEY_THEME]: 'light',
  [APP_UI_KEY_CHECKPOINT_RETENTION]: '100',
  [APP_UI_KEY_SHOW_FULL_TOOL_PARAMS]: 'false',
} as const;
