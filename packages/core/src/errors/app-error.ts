/**
 * 统一错误类。
 *
 * 错误码、可读 key 与静态 desc 定义在 `errors/error-codes.ts`；本文件只负责
 * 运行期错误对象、跨进程序列化形态与 instanceof 守卫。code 给日志、统计与
 * 跨进程用，一经发布永不复用、永不改号；message 保留运行期上下文（路径/id 等）。
 *
 * @module errors/app-error
 */

import type { MessageParams } from "@/common/i18n.js";
import type { CoreMessageDescriptor, CoreMessageKey } from "@/i18n/keys.js";
import { ErrorCodes, type ErrorKey, type ErrorNumber } from "./error-codes.js";

/** 跨进程/日志用的序列化形状。 */
export interface AppErrorWire {
  readonly key: ErrorKey;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly message: string;
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;
  readonly details?: Record<string, unknown>;
}

/**
 * 统一错误类；各域错误随迁移逐步收敛到它。
 *
 * message 通道放宽为 `string | CoreMessageDescriptor`（spec §5 G1.1）：descriptor
 * 时 `Error.message` 取 `ErrorCodes[key].desc`（英文，与未传 message 的缺省一致），
 * `messageKey`/`messageParams` 供边界 `userMessageOf` + translator 翻译——
 * 其他错误类走 key 原文，这里走 desc 是既有 wire 语义（desc 本就是给日志/跨进程的稳定串）。
 */
export class AppError<K extends ErrorKey = ErrorKey> extends Error {
  readonly key: K;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;
  readonly details?: Record<string, unknown>;

  constructor(key: K, message?: string | CoreMessageDescriptor, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(typeof message === "string" ? message : ErrorCodes[key].desc, options);
    this.name = key;
    this.key = key;
    this.code = ErrorCodes[key].code;
    this.desc = ErrorCodes[key].desc;
    if (message != null && typeof message !== "string") {
      this.messageKey = message.key;
      this.messageParams = message.params;
    }
    this.details = details;
  }

  toJSON(): AppErrorWire {
    return {key: this.key, code: this.code, desc: this.desc, message: this.message, ...(this.messageKey == null ? {} : {messageKey: this.messageKey, messageParams: this.messageParams}), details: this.details};
  }
}

/** `instanceof` 收窄；给了 key 时再校一次业务码，并把 key 收窄到该字面量。 */
export function isAppError<K extends ErrorKey = ErrorKey>(error: unknown, key?: K): error is AppError<K> {
  return error instanceof AppError && (key === undefined || error.key === key);
}
