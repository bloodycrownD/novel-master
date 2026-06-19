/**
 * KKV：WebView 流式 bridge 是否走 streamBatch（false 时回退 streamDelta，仍 FIFO 保序）。
 */
import type {AppUiPreferences} from './app-ui-prefs';

export const APP_UI_KEY_CHAT_STREAM_BATCH_ENABLED = 'chatStreamBatchEnabled';

const DEFAULT_BATCH_ENABLED = true;

export async function readChatStreamBatchEnabled(
  appUi: AppUiPreferences | null | undefined,
): Promise<boolean> {
  if (appUi == null) {
    return DEFAULT_BATCH_ENABLED;
  }
  try {
    const raw = await appUi.get(APP_UI_KEY_CHAT_STREAM_BATCH_ENABLED);
    if (raw === 'false') {
      return false;
    }
    if (raw === 'true') {
      return true;
    }
  } catch {
    // fall through
  }
  return DEFAULT_BATCH_ENABLED;
}
