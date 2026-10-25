/**
 * 统一错误类。
 *
 * 错误码、可读 key 与静态 desc 定义在 `errors/error-codes.ts`；本文件只负责
 * 运行期错误对象、跨进程序列化形态与 instanceof 守卫。code 给日志、统计与
 * 跨进程用，一经发布永不复用、永不改号；message 保留运行期上下文（路径/id 等）。
 *
 * @module errors/app-error
 */

import { ErrorCodes, type ErrorKey, type ErrorNumber } from "./error-codes.js";

/** 跨进程/日志用的序列化形状。 */
export interface AppErrorWire {
  readonly key: ErrorKey;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/** 统一错误类；各域错误随迁移逐步收敛到它。 */
export class AppError<K extends ErrorKey = ErrorKey> extends Error {
  readonly key: K;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly details?: Record<string, unknown>;

  constructor(key: K, message?: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(message ?? ErrorCodes[key].desc, options);
    this.name = key;
    this.key = key;
    this.code = ErrorCodes[key].code;
    this.desc = ErrorCodes[key].desc;
    this.details = details;
  }

  toJSON(): AppErrorWire {
    return {key: this.key, code: this.code, desc: this.desc, message: this.message, details: this.details};
  }
}

/** `instanceof` 收窄；给了 key 时再校一次业务码。 */
export function isAppError(error: unknown, key?: ErrorKey): error is AppError {
  return error instanceof AppError && (key === undefined || error.key === key);
}
