/**
 * KKV：WebView 流式 bridge 是否走 streamBatch（false 时回退 streamDelta，仍 FIFO 保序）。
 */
import {APP_UI_KEY_CHAT_STREAM_BATCH_ENABLED} from './app-ui-keys';
import {readBoolPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

const DEFAULT_BATCH_ENABLED = true;

export async function readChatStreamBatchEnabled(
  appUi: AppUiPreferences | null | undefined,
): Promise<boolean> {
  return readBoolPref(
    appUi,
    APP_UI_KEY_CHAT_STREAM_BATCH_ENABLED,
    DEFAULT_BATCH_ENABLED,
  );
}
