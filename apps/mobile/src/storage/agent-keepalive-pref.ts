/**
 * 「后台保活」偏好（appUi 通道，module `nm-mobile-ui`）。
 *
 * 默认关闭：历史行为完全兼容（无常驻通知、无前台服务），开启后生成期间
 * 起前台保活服务并在状态栏常驻「正在生成 · 项目 · 会话」通知。
 *
 * @module storage/agent-keepalive-pref
 */
import {APP_UI_KEY_AGENT_KEEP_ALIVE} from './app-ui-keys';
import {readBoolPref, writeBoolPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

/** 读取「后台保活」开关（默认关）。 */
export async function readAgentKeepAliveEnabled(
  appUi: AppUiPreferences,
): Promise<boolean> {
  return readBoolPref(appUi, APP_UI_KEY_AGENT_KEEP_ALIVE, false);
}

/** 持久化「后台保活」开关。 */
export async function writeAgentKeepAliveEnabled(
  appUi: AppUiPreferences,
  enabled: boolean,
): Promise<void> {
  await writeBoolPref(appUi, APP_UI_KEY_AGENT_KEEP_ALIVE, enabled);
}
