/**
 * KKV keys for mobile UI preferences (module `nm-mobile-ui`).
 *
 * @module storage/app-ui-keys
 */

/** KKV module name for app-only UI settings (never Core workspace modules). */
export const APP_UI_KKV_MODULE = 'nm-mobile-ui';

export const APP_UI_KEY_THEME = 'theme';
/** `true` | `false` — assistant chat bubbles use MD/HTML when true (default off). */
export const APP_UI_KEY_CHAT_RICH_TEXT = 'chatRichText';
/** Last app version seen at bootstrap (package version). */
export const APP_UI_KEY_LAST_RUN_VERSION = 'app.lastRunVersion';
/** Integer string; bumped when app version changes to remount rich text. */
export const APP_UI_KEY_RICH_RENDER_EPOCH = 'app.richRenderEpoch';

/** Default string values when a key is missing. */
export const APP_UI_DEFAULTS = {
  [APP_UI_KEY_THEME]: 'light',
  [APP_UI_KEY_CHAT_RICH_TEXT]: 'false',
} as const;
