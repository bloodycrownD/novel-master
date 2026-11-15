/**
 * 统一错误类。
 *
 * 错误码、可读 key、静态 desc 与缺省 message 模板（messageKey）定义在
 * `errors/error-codes.ts`；本文件负责运行期错误对象、参数类型表
 * {@link ErrorParamsMap}、跨进程序列化形态与 instanceof 守卫。code 给日志、
 * 统计与跨进程用，一经发布永不复用、永不改号；message 保留运行期上下文。
 *
 * 构造统一走 `new AppError(key, params?, options?)`：params 的成员名与类型由
 * {@link ErrorParamsMap} 编译期校验，`detail` 覆盖动态文案，`descriptor`（或
 * params 里第一个 descriptor 形状的成员）接管该次错误的 messageKey。
 *
 * @module errors/app-error
 */

import type { MessageParams } from "@/common/i18n.js";
import type { ZodIssue } from "zod";
import { CORE_MESSAGE_KEY_PATTERN, type CoreMessageDescriptor, type CoreMessageKey } from "@/i18n/keys.js";
import { ErrorCodes, type ErrorCodeDef, type ErrorKey, type ErrorNumber } from "./error-codes.js";

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
 * 每个 key 的 message 参数形态；未登记 = 无参数（只剩 detail/descriptor 通道）。
 *
 * 字段名与既有 details 的实际命名逐字一致（camelCase，不改名）；可选性按既有
 * 调用点实际携带的字段给出（个别既有调用点不带 path，故 `VFS_NOT_FOUND.path`
 * 放宽为可选），message 组装必需项在能保证时必填——缺参会渲染出字面 `{placeholder}`。
 */
export interface ErrorParamsMap {
  AGENT_NOT_FOUND: {readonly agentId: string};
  AGENT_INVALID_MODEL: {readonly modelId?: string};
  VFS_NOT_FOUND: {readonly path?: string; readonly entryId?: number; readonly version?: number; readonly missing?: readonly {readonly entryId: number; readonly version: number}[]; readonly cause?: unknown};
  VFS_REPLACE_NOT_FOUND: {readonly path: string; readonly oldStringLength: number; readonly longestCommonSubstring: string; readonly lcsLength: number; readonly lcsOccurrences: number; readonly oldStringPreview?: string; readonly fileHintPreview?: string};
  VFS_DIRECTORY_NOT_EMPTY: {readonly path: string};
  VFS_INVALID_PATH: {readonly path: string; readonly reason?: string | CoreMessageDescriptor};
  VFS_INVALID_NAME: {readonly path: string; readonly reason?: string | CoreMessageDescriptor};
  VFS_IS_DIRECTORY: {readonly path: string};
  VFS_ALREADY_EXISTS: {readonly path: string};
  VFS_NOT_A_DIRECTORY: {readonly path: string};
  VFS_PARENT_NOT_FOUND: {readonly path: string};
  VFS_INVALID_PATTERN: {readonly pattern: string};
  VFS_CHARACTER_CARD_UNSUPPORTED_SPEC: {readonly spec?: string};
  VFS_CHARACTER_CARD_IMPORT_FAILED: {readonly base?: string};
  VFS_CONTENT_CORRUPT: {readonly format?: string; readonly memberCount?: number; readonly byteLength?: number; readonly headerLength?: number; readonly offset?: number; readonly length?: number; readonly segmentLength?: number; readonly segmentIndex?: number; readonly targetSize?: number; readonly limit?: number; readonly phase?: string; readonly packId?: number; readonly label?: string; readonly actualType?: string};
  VFS_CONTENT_UNSUPPORTED_FORMAT: {readonly format?: string; readonly encoding?: string; readonly label?: string};
  VFS_CONTENT_BLOB_MISSING: {readonly contentHash?: string};
  VFS_RESTORE_FAILED: {readonly causes?: readonly unknown[]};
  VFS_ZIP_INVALID_UTF8: {readonly byteLength?: number};
  VFS_SINGLE_FILE_TOO_LARGE: {readonly sizeBytes: number; readonly maxBytes: number};
  VFS_SINGLE_FILE_READ_FAILED: {readonly reason: string};
  VFS_SINGLE_FILE_NOT_FOUND: {readonly path: string};
  VFS_SINGLE_FILE_EXPORT_TARGET_INVALID: {readonly logicalPath: string};
  TOOL_SEARCH_TEMPLATE_INVALID: {readonly reason?: string};
  TOOL_NOT_FOUND: {readonly toolName: string};
  TOOL_CONFLICT: {readonly toolName: string};
  TOOL_INVALID_ARGUMENT: {readonly toolName: string; readonly issues?: readonly ZodIssue[]};
  TOOL_FAILED: {readonly toolName: string; readonly cause?: unknown};
  TOOL_FORBIDDEN: {readonly toolName: string; readonly path: string};
  TOOL_CANCELLED: {readonly toolName: string; readonly detail?: string};
  PROVIDER_NOT_FOUND: {readonly providerId?: string; readonly modelId?: string};
  PROVIDER_SAVED_MODEL_IN_USE: {readonly modelName?: string; readonly blockingRefs?: string; readonly modelId?: string; readonly providerId?: string};
  PROVIDER_API_KEY_NOT_SET: {readonly providerId?: string};
  PROVIDER_BUILTIN_PROVIDER: {readonly providerId?: string};
  PROVIDER_MODEL_NOT_SAVED: {readonly modelId?: string};
  PROVIDER_INVALID_MODEL_NAME: {readonly modelId?: string};
  PROVIDER_INVALID_SAVED_MODEL_ID: {readonly modelId?: string};
  PROVIDER_INVALID_ARGUMENT: {readonly modelId?: string; readonly providerId?: string; readonly issues?: readonly ZodIssue[]};
  PROVIDER_HTTP_ERROR: {readonly providerId?: string};
  CHAT_NOT_FOUND: {readonly kind: string; readonly id: string; readonly messageId?: string; readonly projectId?: string; readonly sessionId?: string};
  CHAT_INVALID_ARGUMENT: {readonly path?: string};
  CHAT_MESSAGE_CORRUPT: {readonly messageId?: string; readonly field?: string};
  SKILL_INVALID_NAME: {readonly skillName: string; readonly reason?: string | CoreMessageDescriptor};
  SKILL_INVALID_PATH: {readonly path: string; readonly reason?: string | CoreMessageDescriptor};
  SKILL_MISSING_DOMAIN: {readonly skillName: string};
  SKILL_MISSING_PROJECT_ID: {readonly skillName: string};
  SKILL_NOT_FOUND: {readonly skillName: string; readonly path?: string; readonly domain?: string};
  SKILL_BUILTIN: {readonly skillName: string};
  SKILL_BUILTIN_NAME_RESERVED: {readonly skillName: string};
  SKILL_BUILTIN_RENAME: {readonly skillName: string};
  SKILL_ALREADY_EXISTS: {readonly skillName: string};
  SESSION_FS_ROLLBACK_MESSAGE_NOT_FOUND: {readonly messageId: string; readonly sessionId?: string; readonly logicalPath?: string};
  SESSION_FS_ROLLBACK_MESSAGE_SESSION_MISMATCH: {readonly messageId: string; readonly sessionId?: string};
  SESSION_FS_RESTORE_REVISION_MISSING: {readonly logicalPath: string; readonly revisionVersion: number; readonly sessionId?: string; readonly messageId?: string};
  SESSION_FS_ROLLBACK_NO_CHECKPOINT: {readonly messageId?: string; readonly sessionId?: string};
  SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED: {readonly sessionId?: string; readonly messageId?: string; readonly logicalPath?: string};
  SESSION_FS_ROLLBACK_UNDO_SEND_EMPTY_TARGET: {readonly sessionId?: string; readonly messageId?: string};
  SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED: {readonly missingLogicalPaths: readonly string[]; readonly sessionId?: string; readonly messageId?: string};
  SESSION_FS_ROLLBACK_CONFLICT: {readonly expectedMessageCount: number; readonly actualMessageCount: number; readonly sessionId?: string; readonly messageId?: string};
  SESSION_FS_ROLLBACK_TAIL_DRIFT: {readonly expectedMessageCount: number; readonly actualMessageCount: number; readonly sessionId?: string; readonly messageId?: string};
  PROMPT_INVALID_YAML: {readonly offset?: number};
  PROMPT_INVALID_BLOCK: {readonly offset?: number};
  PROMPT_UNKNOWN_FIELD: {readonly offset?: number};
  PROMPT_UNSUPPORTED_SYNTAX: {readonly offset?: number};
  PROMPT_INVALID_MACRO: {readonly cause?: unknown};
  SMART_SORT_RULE_INVALID_ARGUMENT: {readonly ruleId?: string; readonly issues?: readonly ZodIssue[]};
  SMART_SORT_RULE_INVALID_PATTERN: {readonly ruleId?: string};
  SMART_SORT_RULE_NOT_FOUND: {readonly ruleId?: string};
  SMART_SORT_RULE_CONFLICT: {readonly ruleId?: string};
  SMART_SORT_RULE_BUILTIN_PROTECTED: {readonly ruleId?: string};
  KKV_NOT_FOUND: {readonly module: string; readonly key: string};
  PREFERENCES_INVALID_VALUE: {readonly key: string; readonly expectedType: string; readonly actualValue: string};
}

/** 构造参数形态：已登记 key 用表内字段，未登记 key 不收参数；`detail`/`descriptor` 全局可选。 */
export type ErrorParams<K extends ErrorKey> = (K extends keyof ErrorParamsMap ? ErrorParamsMap[K] : Record<never, never>) & {
  readonly detail?: string;
  /** descriptor 通道：需要走 CoreMessageDescriptor 的 key 用这个成员 */
  readonly descriptor?: CoreMessageDescriptor;
};

/** 值是 core 消息 descriptor（key 命中 keyRule；params 里的 `key` 字符串字段不会误判）。 */
function isCoreMessageDescriptor(value: unknown): value is CoreMessageDescriptor {
  return typeof value === "object" && value != null && typeof (value as {key?: unknown}).key === "string" && CORE_MESSAGE_KEY_PATTERN.test((value as {key: string}).key);
}

/**
 * 取 params 里的 descriptor（spec §2.3 契约）：先读 `params.descriptor`；无则
 * 返回第一个 descriptor 形状的顶层成员值；再无则 undefined。
 */
export function firstDescriptorOf(params: unknown): CoreMessageDescriptor | undefined {
  if (typeof params !== "object" || params == null) {
    return undefined;
  }
  const direct = (params as {descriptor?: unknown}).descriptor;
  if (isCoreMessageDescriptor(direct)) {
    return direct;
  }
  for (const value of Object.values(params as Record<string, unknown>)) {
    if (typeof value === "object" && value != null && "key" in value && typeof (value as {key?: unknown}).key === "string") {
      return value as CoreMessageDescriptor;
    }
  }
  return undefined;
}

/** 顶层成员名 camelCase → snake_case（浅转换；catalog 模板占位是 snake_case）。 */
export function toSnakeCase(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(params)) {
    out[name.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)] = value;
  }
  return out;
}

/**
 * 统一错误类；各域错误随迁移逐步收敛到它。
 *
 * message 取值顺序 `params.detail → desc`：descriptor 命中时 `Error.message`
 * 仍取英文 desc（既有 wire 语义，desc 本就是给日志/跨进程的稳定串），
 * `messageKey`/`messageParams` 才是 i18n 通道。`params.cause` 双写：既进
 * `Error.cause` 又随 details 透出，两条消费路径都不破。
 */
export class AppError<K extends ErrorKey = ErrorKey> extends Error {
  readonly key: K;
  readonly code: ErrorNumber;
  readonly desc: string;
  readonly messageKey?: CoreMessageKey;
  readonly messageParams?: MessageParams;
  readonly details?: Record<string, unknown>;

  constructor(key: K, params?: ErrorParams<K>, options?: ErrorOptions) {
    const def: ErrorCodeDef = ErrorCodes[key];
    const descriptor = firstDescriptorOf(params);
    super(params?.detail ?? def.desc, {cause: (params as {cause?: unknown} | undefined)?.cause ?? options?.cause});
    this.name = key;
    this.key = key;
    this.code = ErrorCodes[key].code;
    this.desc = def.desc;
    this.messageKey = descriptor?.key ?? def.messageKey;
    // descriptor 命中时 messageParams 只取 descriptor.params（为空即 undefined，与旧 VfsError
    // wire 一致）；不再回退 toSnakeCase(params)——那会把 descriptor 对象自身当参数透传出去。
    this.messageParams = descriptor != null ? descriptor.params : (params == null ? undefined : toSnakeCase(params as Record<string, unknown>) as MessageParams);
    this.details = params as Record<string, unknown> | undefined;
  }

  toJSON(): AppErrorWire {
    return {key: this.key, code: this.code, desc: this.desc, message: this.message, ...(this.messageKey == null ? {} : {messageKey: this.messageKey, messageParams: this.messageParams}), details: this.details};
  }
}

/** `instanceof` 收窄；给了 key 时再校一次业务码，并把 key 收窄到该字面量。 */
export function isAppError<K extends ErrorKey = ErrorKey>(error: unknown, key?: K): error is AppError<K> {
  return error instanceof AppError && (key === undefined || error.key === key);
}
