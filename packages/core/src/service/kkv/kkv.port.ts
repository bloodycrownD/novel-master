/**
 * KKV application service port.
 *
 * @module service/kkv/kkv.port
 */

import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/**
 * Module-scoped key-value store.
 *
 * @remarks Keys are isolated per module; get/delete on a missing key return
 * `Result.err` with `KKV_NOT_FOUND`（已知失败走返回值，未知异常仍走 throw）。
 */
export interface KkvService {
  listKeys(module: string): Promise<string[]>;

  get(module: string, key: string): Promise<Result<string, AppError>>;

  set(module: string, key: string, value: string): Promise<void>;

  delete(module: string, key: string): Promise<Result<void, AppError>>;
}
