/**
 * Workspace preference: LLM chat streaming on/off.
 */
import {
  APP_UI_DEFAULTS,
  APP_UI_KEY_LLM_STREAM,
} from './app-ui-keys';
import type {AppUiPreferences} from './app-ui-prefs';

export async function readLlmStreamEnabled(
  appUi: AppUiPreferences,
): Promise<boolean> {
  const raw = await appUi.get(APP_UI_KEY_LLM_STREAM);
  const value = raw ?? APP_UI_DEFAULTS[APP_UI_KEY_LLM_STREAM];
  return value !== 'false';
}

export async function writeLlmStreamEnabled(
  appUi: AppUiPreferences,
  enabled: boolean,
): Promise<void> {
  await appUi.set(APP_UI_KEY_LLM_STREAM, enabled ? 'true' : 'false');
}
