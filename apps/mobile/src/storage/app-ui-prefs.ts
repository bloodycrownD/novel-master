/**
 * App UI preferences backed by {@link KkvService} module `nm-mobile-ui`.
 *
 * @module storage/app-ui-prefs
 */

import {KkvError} from '@novel-master/core';
import type {KkvService} from '@novel-master/core/kkv';
import {
  APP_UI_DEFAULTS,
  APP_UI_KKV_MODULE,
  APP_UI_KEY_CHAT_RICH_TEXT,
  APP_UI_KEY_THEME,
} from './app-ui-keys';

/** String key-value UI preferences (prototype-aligned). */
export interface AppUiPreferences {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

/**
 * Creates UI preference accessors; missing keys resolve to defaults then `undefined` for unknown keys.
 */
export function createAppUiPreferences(kkv: KkvService): AppUiPreferences {
  const defaults = APP_UI_DEFAULTS as Record<string, string>;

  return {
    async get(key: string) {
      try {
        return await kkv.get(APP_UI_KKV_MODULE, key);
      } catch (error) {
        if (error instanceof KkvError && error.code === 'NOT_FOUND') {
          return key in defaults ? defaults[key] : undefined;
        }
        throw error;
      }
    },
    async set(key: string, value: string) {
      await kkv.set(APP_UI_KKV_MODULE, key, value);
    },
    async delete(key: string) {
      try {
        await kkv.delete(APP_UI_KKV_MODULE, key);
      } catch (error) {
        if (error instanceof KkvError && error.code === 'NOT_FOUND') {
          return;
        }
        throw error;
      }
    },
    async listKeys() {
      return kkv.listKeys(APP_UI_KKV_MODULE);
    },
  };
}

/** Typed helpers for Client UI keys. */
export const appUiKeys = {
  theme: APP_UI_KEY_THEME,
  chatRichText: APP_UI_KEY_CHAT_RICH_TEXT,
} as const;
