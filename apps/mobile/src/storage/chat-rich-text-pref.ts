/**
 * Workspace preference: assistant chat rich text (MD/HTML) on/off.
 */
import {APP_UI_KEY_CHAT_RICH_TEXT} from './app-ui-keys';
import {readBoolPref, writeBoolPref} from './app-ui-pref-io';
import type {AppUiPreferences} from './app-ui-prefs';

/** Reads whether assistant messages should render as MD/HTML (default off). */
export async function readChatRichTextEnabled(
  appUi: AppUiPreferences,
): Promise<boolean> {
  return readBoolPref(appUi, APP_UI_KEY_CHAT_RICH_TEXT, false);
}

/** Persists assistant rich-text preference. */
export async function writeChatRichTextEnabled(
  appUi: AppUiPreferences,
  enabled: boolean,
): Promise<void> {
  await writeBoolPref(appUi, APP_UI_KEY_CHAT_RICH_TEXT, enabled);
}
