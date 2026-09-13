/**
 * 「消息通知」总开关偏好（appUi 通道，module `nm-mobile-ui`）。
 *
 * 开启（默认）：生成期间常驻保活（前台服务 + 多会话聚合常驻通知）+
 * run 结束且 app 在后台时发完成通知。关闭：两者全停，生成行为不变。
 * 合并自原「生成结束通知」「常驻通知」两个偏好（未发布，无迁移负担）。
 *
 * @module storage/message-notification-pref
 */
import {APP_UI_KEY_MESSAGE_NOTIFICATION} from './app-ui-keys';
import {readBoolPref, writeBoolPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

/** 读取「消息通知」总开关（默认开）。 */
export async function readMessageNotificationEnabled(
  appUi: AppUiPreferences,
): Promise<boolean> {
  return readBoolPref(appUi, APP_UI_KEY_MESSAGE_NOTIFICATION, true);
}

/** 持久化「消息通知」总开关。 */
export async function writeMessageNotificationEnabled(
  appUi: AppUiPreferences,
  enabled: boolean,
): Promise<void> {
  await writeBoolPref(appUi, APP_UI_KEY_MESSAGE_NOTIFICATION, enabled);
}
