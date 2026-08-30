/**
 * 「生成结束通知」偏好（appUi 通道，module `nm-mobile-ui`）。
 *
 * 默认开启；关闭后仅不再发完成通知，生成与后台保活行为不变。
 *
 * @module storage/agent-finished-notification-pref
 */
import {APP_UI_KEY_AGENT_FINISHED_NOTIFICATION} from './app-ui-keys';
import {readBoolPref, writeBoolPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

/** 读取「生成结束通知」开关（默认开）。 */
export async function readAgentFinishedNotificationEnabled(
  appUi: AppUiPreferences,
): Promise<boolean> {
  return readBoolPref(appUi, APP_UI_KEY_AGENT_FINISHED_NOTIFICATION, true);
}

/** 持久化「生成结束通知」开关。 */
export async function writeAgentFinishedNotificationEnabled(
  appUi: AppUiPreferences,
  enabled: boolean,
): Promise<void> {
  await writeBoolPref(appUi, APP_UI_KEY_AGENT_FINISHED_NOTIFICATION, enabled);
}
