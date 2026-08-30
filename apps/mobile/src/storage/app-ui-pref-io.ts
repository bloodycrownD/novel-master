/**
 * Shared read/write helpers for app-ui KKV string preferences.
 *
 * 统一读写口径：读失败（KKV 异常）与非法值一律回退默认值；写失败保留 reject
 * 语义（调用方靠 catch 回滚/toast），只补一条 warn 日志。
 *
 * @module storage/app-ui-pref-io
 */
import type {AppUiPreferences} from './app-ui-prefs';

/** Reads an enum pref; missing/invalid values and KKV errors fall back. */
export async function readEnumPref<T extends string>(
  appUi: AppUiPreferences | null | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): Promise<T> {
  if (appUi == null) {
    return fallback;
  }
  try {
    const raw = await appUi.get(key);
    if (raw != null && (allowed as readonly string[]).includes(raw)) {
      return raw as T;
    }
  } catch {
    // 读失败按未配置处理，回退默认值。
  }
  return fallback;
}

/** Reads a `'true' | 'false'` pref; missing/invalid values and KKV errors fall back. */
export async function readBoolPref(
  appUi: AppUiPreferences | null | undefined,
  key: string,
  fallback: boolean,
): Promise<boolean> {
  if (appUi == null) {
    return fallback;
  }
  try {
    const raw = await appUi.get(key);
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
  } catch {
    // 读失败按未配置处理，回退默认值。
  }
  return fallback;
}

/**
 * Persists a bool pref as `'true' | 'false'`.
 *
 * 写失败仍然 reject：AboutScreen / ChatConfigScreen 等调用方依赖 reject 做
 * 失败提示或回滚，吞掉会让持久化失败静默。
 */
export async function writeBoolPref(
  appUi: AppUiPreferences,
  key: string,
  value: boolean,
): Promise<void> {
  try {
    await appUi.set(key, value ? 'true' : 'false');
  } catch (error) {
    console.warn(`[app-ui-pref] write ${key} failed:`, error);
    throw error;
  }
}
