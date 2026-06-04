/**
 * Mobile app UI preference for token counter mode (`tokenCounter.mode`).
 */
import {
  parseTokenCounterModePref,
  TOKEN_COUNTER_MODE_PREF_KEY,
  type KkvService,
  type TokenizerOverride,
} from '@novel-master/core';
import {APP_UI_KKV_MODULE} from './app-ui-keys';

/** Reads mobile UI token counter mode (falls back to `auto`). */
export async function readTokenCounterModeFromAppUi(
  kkv: KkvService,
): Promise<TokenizerOverride> {
  try {
    const raw = await kkv.get(APP_UI_KKV_MODULE, TOKEN_COUNTER_MODE_PREF_KEY);
    return parseTokenCounterModePref(raw);
  } catch {
    return 'auto';
  }
}

/** Persists token counter mode to mobile UI KKV. */
export async function writeTokenCounterModeToAppUi(
  kkv: KkvService,
  mode: TokenizerOverride,
): Promise<void> {
  await kkv.set(APP_UI_KKV_MODULE, TOKEN_COUNTER_MODE_PREF_KEY, mode);
}
