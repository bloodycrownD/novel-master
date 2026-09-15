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
/** `true` | `false` — 消息通知总开关（默认关）：开启后进入应用即常驻
 * 状态栏保活（前台服务 + 多会话聚合的常驻通知），生成中显示状态，
 * run 结束且 app 在后台时发完成通知；关闭则无常驻通知、无提醒
 * （生成行为不受影响）。 */
export const APP_UI_KEY_MESSAGE_NOTIFICATION = 'messageNotification';
/** `legacy-rn` | `webview` — transcript rendering engine (default `webview`). */
export const APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE = 'chatTranscriptEngine';
/** `rn` | `webview` — VFS markdown preview engine (default `webview`). */
export const APP_UI_KEY_VFS_MARKDOWN_PREVIEW_ENGINE =
  'vfsMarkdownPreviewEngine';
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
  // KKV 未写值（get 抛 NOT_FOUND）时的功能性回退，锁定消息通知默认关；
  // 与 readMessageNotificationEnabled 的 readBoolPref 第三参 false 联动，
  // 两处缺一不可（只改第三参时存量未写值用户 get 永远回退 'true'）。
  [APP_UI_KEY_MESSAGE_NOTIFICATION]: 'false',
  [APP_UI_KEY_UPDATES_AUTO_CHECK]: 'true',
} as const;
