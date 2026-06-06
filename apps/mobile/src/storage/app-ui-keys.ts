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
/** `true` | `false` — workspace chat uses SSE streaming when true. */
export const APP_UI_KEY_LLM_STREAM = 'llmStream';
/** `true` | `false` — assistant chat bubbles use MD/HTML when true (default off). */
export const APP_UI_KEY_CHAT_RICH_TEXT = 'chatRichText';
/** Last app version seen at bootstrap (package version). */
export const APP_UI_KEY_LAST_RUN_VERSION = 'app.lastRunVersion';
/** Integer string; bumped when app version changes to remount rich text. */
export const APP_UI_KEY_RICH_RENDER_EPOCH = 'app.richRenderEpoch';

/** Default string values when a key is missing. */
export const APP_UI_DEFAULTS = {
  [APP_UI_KEY_THEME]: 'light',
  [APP_UI_KEY_CHECKPOINT_RETENTION]: '100',
  [APP_UI_KEY_SHOW_FULL_TOOL_PARAMS]: 'false',
  [APP_UI_KEY_LLM_STREAM]: 'true',
  [APP_UI_KEY_CHAT_RICH_TEXT]: 'false',
} as const;
