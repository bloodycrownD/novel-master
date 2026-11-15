/**
 * App UI preferences backed by {@link KkvService} module `nm-mobile-ui`.
 *
 * @module storage/app-ui-prefs
 */

import {isAppError} from '@novel-master/core/agent';
import type {KkvService} from '@novel-master/core/kkv';
import {APP_UI_DEFAULTS, APP_UI_KKV_MODULE} from './app-ui-keys';

/** String key-value UI preferences (prototype-aligned). */
export interface AppUiPreferences {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

/**
 * Creates UI preference accessors; missing keys resolve to defaults then `undefined` for unknown keys.
 *
 * 解包 throw 边界（错误通道迁移三期门⑦）：本文件是 KKV `Result` → 端内异常
 * 通道的转码点——`KKV_NOT_FOUND` 归一为默认值/`undefined`，其余失败原样
 * throw。读路径消费方 readEnumPref/readBoolPref（app-ui-pref-io）紧邻 catch
 * 回退默认值；写路径调用方（AboutScreen 等）靠 catch 提示/回滚。
 */
export function createAppUiPreferences(kkv: KkvService): AppUiPreferences {
  const defaults = APP_UI_DEFAULTS as Record<string, string>;

  return {
    async get(key: string) {
      const raw = await kkv.get(APP_UI_KKV_MODULE, key);
      if (!raw.ok) {
        if (isAppError(raw.error, 'KKV_NOT_FOUND')) {
          return key in defaults ? defaults[key] : undefined;
        }
        throw raw.error;
      }
      return raw.value;
    },
    async set(key: string, value: string) {
      await kkv.set(APP_UI_KKV_MODULE, key, value);
    },
    async listKeys() {
      return kkv.listKeys(APP_UI_KKV_MODULE);
    },
  };
}
