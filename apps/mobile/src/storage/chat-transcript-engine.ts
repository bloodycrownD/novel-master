/**
 * Feature flag: legacy RN MessageList vs WebView transcript engine.
 * Default webview in __DEV__ for M0 POC; production stays legacy until M4.
 */
import type {AppUiPreferences} from './app-ui-prefs';

export type ChatTranscriptEngine = 'legacy-rn' | 'webview';

export const APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE = 'chatTranscriptEngine';

const DEFAULT_ENGINE: ChatTranscriptEngine = __DEV__
  ? 'webview'
  : 'legacy-rn';

export function defaultChatTranscriptEngine(): ChatTranscriptEngine {
  return DEFAULT_ENGINE;
}

export async function readChatTranscriptEngine(
  appUi: AppUiPreferences | null | undefined,
): Promise<ChatTranscriptEngine> {
  if (appUi == null) {
    return DEFAULT_ENGINE;
  }
  try {
    const raw = await appUi.get(APP_UI_KEY_CHAT_TRANSCRIPT_ENGINE);
    if (raw === 'legacy-rn' || raw === 'webview') {
      return raw;
    }
  } catch {
    // fall through
  }
  return DEFAULT_ENGINE;
}
