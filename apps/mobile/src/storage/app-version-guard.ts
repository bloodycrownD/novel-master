/**
 * App version guard: bumps rich-text render epoch when package version changes.
 *
 * @module storage/app-version-guard
 */
import type {AppUiPreferences} from './app-ui-prefs';
import {
  APP_UI_KEY_LAST_RUN_VERSION,
  APP_UI_KEY_RICH_RENDER_EPOCH,
} from './app-ui-keys';

function parseEpoch(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '0', 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Compares `currentVersion` to stored last-run version; on change increments epoch.
 * Call once after UI prefs are available at bootstrap.
 */
export async function syncAppVersionForRichRender(
  appUi: AppUiPreferences,
  currentVersion: string,
): Promise<number> {
  const lastRun = await appUi.get(APP_UI_KEY_LAST_RUN_VERSION);
  let epoch = parseEpoch(await appUi.get(APP_UI_KEY_RICH_RENDER_EPOCH));

  if (lastRun !== currentVersion) {
    epoch += 1;
    await appUi.set(APP_UI_KEY_LAST_RUN_VERSION, currentVersion);
    await appUi.set(APP_UI_KEY_RICH_RENDER_EPOCH, String(epoch));
  }

  return epoch;
}

/** Reads the persisted rich-text remount epoch (no version sync). */
export async function readRichRenderEpoch(
  appUi: AppUiPreferences,
): Promise<number> {
  return parseEpoch(await appUi.get(APP_UI_KEY_RICH_RENDER_EPOCH));
}
