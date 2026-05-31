/**
 * Workspace preference: assistant chat rich text (MD/HTML) on/off.
 */
import {
  APP_UI_DEFAULTS,
  APP_UI_KEY_CHAT_RICH_TEXT,
} from './app-ui-keys';
import type {AppUiPreferences} from './app-ui-prefs';

/** Reads whether assistant messages should render as MD/HTML (default off). */
export async function readChatRichTextEnabled(
  appUi: AppUiPreferences,
): Promise<boolean> {
  const raw = await appUi.get(APP_UI_KEY_CHAT_RICH_TEXT);
  const value = raw ?? APP_UI_DEFAULTS[APP_UI_KEY_CHAT_RICH_TEXT];
  return value === 'true';
}

/** Persists assistant rich-text preference. */
export async function writeChatRichTextEnabled(
  appUi: AppUiPreferences,
  enabled: boolean,
): Promise<void> {
  await appUi.set(APP_UI_KEY_CHAT_RICH_TEXT, enabled ? 'true' : 'false');
}
