/**
 * Read/write helpers for update-check Client UI preferences.
 */
import {
  APP_UI_DEFAULTS,
  APP_UI_KEY_UPDATES_AUTO_CHECK,
  APP_UI_KEY_UPDATES_DISMISSED_VERSION,
  APP_UI_KEY_UPDATES_LAST_CHECK_AT,
  APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION,
  APP_UI_KEY_UPDATES_LAST_CHECK_STATUS,
} from './app-ui-keys';
import type {AppUiPreferences} from './app-ui-prefs';
import type {UpdateCheckData} from '../update-check/types';

/** Reads auto-check toggle (default on). */
export async function readUpdatesAutoCheck(
  appUi: AppUiPreferences,
): Promise<boolean> {
  const raw = await appUi.get(APP_UI_KEY_UPDATES_AUTO_CHECK);
  const value = raw ?? APP_UI_DEFAULTS[APP_UI_KEY_UPDATES_AUTO_CHECK];
  return value === 'true';
}

export async function writeUpdatesAutoCheck(
  appUi: AppUiPreferences,
  enabled: boolean,
): Promise<void> {
  await appUi.set(
    APP_UI_KEY_UPDATES_AUTO_CHECK,
    enabled ? 'true' : 'false',
  );
}

export async function readDismissedVersion(
  appUi: AppUiPreferences,
): Promise<string | undefined> {
  return appUi.get(APP_UI_KEY_UPDATES_DISMISSED_VERSION);
}

export async function writeDismissedVersion(
  appUi: AppUiPreferences,
  version: string,
): Promise<void> {
  await appUi.set(APP_UI_KEY_UPDATES_DISMISSED_VERSION, version);
}

export async function readLastCheckAt(
  appUi: AppUiPreferences,
): Promise<string | undefined> {
  return appUi.get(APP_UI_KEY_UPDATES_LAST_CHECK_AT);
}

export async function readLastCheckStatus(
  appUi: AppUiPreferences,
): Promise<string | undefined> {
  return appUi.get(APP_UI_KEY_UPDATES_LAST_CHECK_STATUS);
}

export async function readLastCheckRemoteVersion(
  appUi: AppUiPreferences,
): Promise<string | undefined> {
  return appUi.get(APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION);
}

/** Persists last check metadata after manual or automatic check. */
export async function persistUpdateCheckResult(
  appUi: AppUiPreferences,
  data: UpdateCheckData | null,
): Promise<void> {
  const now = new Date().toISOString();
  await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_AT, now);
  if (data) {
    await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION, data.remoteVersion);
    await appUi.set(
      APP_UI_KEY_UPDATES_LAST_CHECK_STATUS,
      data.status === 'update-available' ? 'available' : 'up-to-date',
    );
  } else {
    await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_STATUS, 'error');
  }
}
