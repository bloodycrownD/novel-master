/**
 * Persistent preferences 错误工厂：统一返回 `AppError`。
 *
 * @module errors/preferences-errors
 */

import { AppError } from "./app-error.js";

/** 持久化偏好的值无法转换为请求的类型。 */
export function preferencesInvalidValue(key: string, expectedType: string, actualValue: string): AppError<"PREFERENCES_INVALID_VALUE"> {
  return new AppError("PREFERENCES_INVALID_VALUE", `Preference key "${key}" expected ${expectedType}, got: ${actualValue}`, {
    key,
    expectedType,
    actualValue,
  });
}
