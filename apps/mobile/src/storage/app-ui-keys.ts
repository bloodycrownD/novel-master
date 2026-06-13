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

/** Update-check preferences (Client UI layer — not nm-preferences). */
export const APP_UI_KEY_UPDATES_AUTO_CHECK = 'updates.autoCheck';
export const APP_UI_KEY_UPDATES_LAST_CHECK_AT = 'updates.lastCheckAt';
export const APP_UI_KEY_UPDATES_LAST_CHECK_STATUS = 'updates.lastCheckStatus';
export const APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION =
  'updates.lastCheckRemoteVersion';
export const APP_UI_KEY_UPDATES_DISMISSED_VERSION = 'updates.dismissedVersion';
/** ISO-8601 — suppress auto-check result modal until this instant. */
export const APP_UI_KEY_UPDATES_SNOOZE_UNTIL = 'updates.snoozeUntil';

/** Default string values when a key is missing. */
export const APP_UI_DEFAULTS = {
  [APP_UI_KEY_THEME]: 'light',
  [APP_UI_KEY_CHAT_RICH_TEXT]: 'false',
  [APP_UI_KEY_UPDATES_AUTO_CHECK]: 'true',
} as const;
