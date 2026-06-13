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
  APP_UI_KEY_UPDATES_SNOOZE_UNTIL,
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

/** 24h snooze window after user taps「今日不再提醒」. */
const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Returns true when snoozeUntil is in the future. */
export function isSnoozed(snoozeUntil: string | undefined): boolean {
  if (!snoozeUntil) return false;
  const until = Date.parse(snoozeUntil);
  if (!Number.isFinite(until)) return false;
  return Date.now() < until;
}

export async function readSnoozeUntil(
  appUi: AppUiPreferences,
): Promise<string | undefined> {
  return appUi.get(APP_UI_KEY_UPDATES_SNOOZE_UNTIL);
}

export async function writeSnoozeUntil(
  appUi: AppUiPreferences,
): Promise<void> {
  const until = new Date(Date.now() + UPDATE_SNOOZE_MS).toISOString();
  await appUi.set(APP_UI_KEY_UPDATES_SNOOZE_UNTIL, until);
}

/** Persists successful check metadata (updates lastCheckAt for About page). */
export async function persistUpdateCheckResult(
  appUi: AppUiPreferences,
  data: UpdateCheckData,
): Promise<void> {
  const now = new Date().toISOString();
  await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_AT, now);
  await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION, data.remoteVersion);
  await appUi.set(
    APP_UI_KEY_UPDATES_LAST_CHECK_STATUS,
    data.status === 'update-available' ? 'available' : 'up-to-date',
  );
}

/** Persists failed check status (lastCheckAt unchanged). */
export async function persistFailedUpdateCheck(
  appUi: AppUiPreferences,
): Promise<void> {
  await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_STATUS, 'error');
}
