/**
 * App UI preferences backed by {@link KkvService} module `nm-mobile-ui`.
 *
 * @module storage/app-ui-prefs
 */

import {AppErrorOps, Result, AppError} from '@novel-master/core/errors';
import type {KkvService} from '@novel-master/core/kkv';
import {APP_UI_DEFAULTS, APP_UI_KKV_MODULE} from './app-ui-keys';

/** String key-value UI preferences (prototype-aligned). */
export interface AppUiPreferences {
  get(key: string): Promise<Result<string | undefined, AppError>>;
  set(key: string, value: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

export const AppUiPrefs = {
  /**
   * Creates UI preference accessors; missing keys resolve to defaults then `undefined` for unknown keys.
   *
   * 失败通道（错误通道迁移四期）：`KKV_NOT_FOUND` 归一为默认值/`undefined`（Ok），
   * 其余已知失败走 `Result.err` 交给调用方接力——读路径消费方
   * readEnumPref/readBoolPref（app-ui-pref-io）失败回退默认值；写路径调用方
   * （AboutScreen 等）保留可见失败。
   */
  // nm-style: keep-public — app-ui-prefs.test.ts describe 直接 import 构造；chat-rich-text-pref / message-notification-pref 消费同一工厂，测试锁名
  create: (kkv: KkvService): AppUiPreferences => {
    const defaults = APP_UI_DEFAULTS as Record<string, string>;

    return {
      async get(key: string) {
        const raw = await kkv.get(APP_UI_KKV_MODULE, key);
        if (raw.ok) {
          return Result.ok(raw.value);
        }
        if (AppErrorOps.is(raw.error, 'KKV_NOT_FOUND')) {
          return Result.ok(key in defaults ? defaults[key] : undefined);
        }
        return Result.err(raw.error);
      },
      async set(key: string, value: string) {
        await kkv.set(APP_UI_KKV_MODULE, key, value);
      },
      async listKeys() {
        return kkv.listKeys(APP_UI_KKV_MODULE);
      },
    };
  },
} as const;
