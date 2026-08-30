/**
 * Feature flag: legacy RN MessageList vs WebView transcript engine.
 *
 * Default: `webview` (Release and Debug). Override via KKV `chatTranscriptEngine`
 * (`legacy-rn` | `webview`) for rollback without reinstalling.
 */
import {APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE} from './app-ui-keys';
import {readEnumPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

export type ChatTranscriptEngine = 'legacy-rn' | 'webview';

const DEFAULT_ENGINE: ChatTranscriptEngine = 'webview';
const ALLOWED_ENGINES: readonly ChatTranscriptEngine[] = ['legacy-rn', 'webview'];

export function defaultChatTranscriptEngine(): ChatTranscriptEngine {
  return DEFAULT_ENGINE;
}

export async function readChatTranscriptEngine(
  appUi: AppUiPreferences | null | undefined,
): Promise<ChatTranscriptEngine> {
  return readEnumPref(
    appUi,
    APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE,
    ALLOWED_ENGINES,
    DEFAULT_ENGINE,
  );
}
