/**
 * Shared read/write helpers for app-ui KKV string preferences.
 *
 * 统一读写口径：读失败（KKV 异常）与非法值一律回退默认值；写失败沿 Result 回传
 * （调用方按 !ok 做回滚 / toast），并补一条 warn 日志。
 *
 * @module storage/app-ui-pref-io
 */
import {Result} from '@novel-master/core/errors';
import type {AppUiPreferences} from './app-ui-prefs';

export const AppUiPrefIo = {
    /** Reads an enum pref; missing/invalid values and KKV errors fall back. */
    readEnumPref: async <T extends string>(appUi: AppUiPreferences | null | undefined, key: string, allowed: readonly T[], fallback: T): Promise<T> => {
        if (appUi == null) {
            return fallback;
        }
        // 读失败按未配置处理，回退默认值（错误通道迁移四期：get 走 Result）。
        const raw = await appUi.get(key);
        if (raw.ok && raw.value != null && (allowed as readonly string[]).includes(raw.value)) {
            return raw.value as T;
        }
        return fallback;
    },

    /** Reads a `'true' | 'false'` pref; missing/invalid values and KKV errors fall back. */
    readBoolPref: async (appUi: AppUiPreferences | null | undefined, key: string, fallback: boolean): Promise<boolean> => {
        if (appUi == null) {
            return fallback;
        }
        const raw = await appUi.get(key);
        if (raw.ok && raw.value === 'true') {
            return true;
        }
        if (raw.ok && raw.value === 'false') {
            return false;
        }
        return fallback;
    },

    /** Persists a bool pref as `'true' | 'false'`；写失败沿 Result 回传（调用方按 !ok 做失败提示或回滚，吞掉会让持久化失败静默）。 */
    writeBoolPref: async (appUi: AppUiPreferences, key: string, value: boolean): Promise<Result<void, Error>> => {
        try {
            await appUi.set(key, value ? 'true' : 'false');
            return Result.ok(undefined);
        } catch (error) {
            console.warn(`[app-ui-pref] write ${key} failed:`, error);
            return Result.err(error instanceof Error ? error : new Error(String(error)));
        }
    },
} as const;
