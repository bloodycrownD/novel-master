/**
 * KKV 错误工厂：统一返回 `AppError`。
 *
 * @module errors/kkv-errors
 */

import { AppError } from "./app-error.js";

/** Key 在模块内不存在。 */
export function kkvNotFound(module: string, key: string): AppError<"KKV_NOT_FOUND"> {
  return new AppError("KKV_NOT_FOUND", `KKV key not found: ${module}/${key}`, {
    module,
    key,
  });
}
