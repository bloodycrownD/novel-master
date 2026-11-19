/**
 * Read/write helpers for update-check Client UI preferences.
 */
import {
  APP_UI_KEY_UPDATES_DISMISSED_VERSION,
  APP_UI_KEY_UPDATES_LAST_CHECK_AT,
  APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION,
  APP_UI_KEY_UPDATES_LAST_CHECK_STATUS,
  APP_UI_KEY_UPDATES_SNOOZE_UNTIL,
} from './app-ui-keys';
import type {Result} from '@novel-master/core/errors';
import type {AppError} from '@novel-master/core/errors';
import type {AppUiPreferences} from './app-ui-prefs';
import type {UpdateCheckData} from '@novel-master/core/common';

/** 24h snooze window after user taps「今日不再提醒」. */
const UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

export const UpdatePrefs = {
  readDismissedVersion: async (appUi: AppUiPreferences): Promise<Result<string | undefined, AppError>> => {
    return appUi.get(APP_UI_KEY_UPDATES_DISMISSED_VERSION);
  },

  writeDismissedVersion: async (appUi: AppUiPreferences, version: string): Promise<void> => {
    await appUi.set(APP_UI_KEY_UPDATES_DISMISSED_VERSION, version);
  },

  readLastCheckStatus: async (appUi: AppUiPreferences): Promise<Result<string | undefined, AppError>> => {
    return appUi.get(APP_UI_KEY_UPDATES_LAST_CHECK_STATUS);
  },

  readLastCheckRemoteVersion: async (appUi: AppUiPreferences): Promise<Result<string | undefined, AppError>> => {
    return appUi.get(APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION);
  },

  /** Returns true when snoozeUntil is in the future. */
  isSnoozed: (snoozeUntil: string | undefined): boolean => {
    if (!snoozeUntil) return false;
    const until = Date.parse(snoozeUntil);
    if (!Number.isFinite(until)) return false;
    return Date.now() < until;
  },

  readSnoozeUntil: async (appUi: AppUiPreferences): Promise<Result<string | undefined, AppError>> => {
    return appUi.get(APP_UI_KEY_UPDATES_SNOOZE_UNTIL);
  },

  writeSnoozeUntil: async (appUi: AppUiPreferences): Promise<void> => {
    const until = new Date(Date.now() + UPDATE_SNOOZE_MS).toISOString();
    await appUi.set(APP_UI_KEY_UPDATES_SNOOZE_UNTIL, until);
  },

  /** Persists successful check metadata (updates lastCheckAt for About page). */
  persistUpdateCheckResult: async (appUi: AppUiPreferences, data: UpdateCheckData): Promise<void> => {
    const now = new Date().toISOString();
    await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_AT, now);
    await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_REMOTE_VERSION, data.remoteVersion);
    await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_STATUS, data.status === 'update-available' ? 'available' : 'up-to-date');
  },

  /** Persists failed check status (lastCheckAt unchanged). */
  persistFailedUpdateCheck: async (appUi: AppUiPreferences): Promise<void> => {
    await appUi.set(APP_UI_KEY_UPDATES_LAST_CHECK_STATUS, 'error');
  },
} as const;
