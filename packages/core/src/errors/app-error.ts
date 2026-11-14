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
 * params 里第一个 descriptor 形状的成员）接管该次错误的 messageKey；旧四参
 * 签名 `(key, message?, details?, options?)` 过渡期保留（一期 Step 11 前删除）。
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
 * 字段名与既有 details 的实际命名逐字一致（camelCase，不改名）；可选性只给
 * 真可选的域字段，message 组装必需项必填——缺参会渲染出字面 `{placeholder}`。
 */
export interface ErrorParamsMap {
  AGENT_NOT_FOUND: {readonly agentId: string};
  AGENT_INVALID_MODEL: {readonly modelId?: string};
  VFS_NOT_FOUND: {readonly path: string};
  VFS_REPLACE_NOT_FOUND: {readonly path: string; readonly oldStringLength: number; readonly longestCommonSubstring: string; readonly lcsLength: number; readonly lcsOccurrences: number; readonly oldStringPreview?: string; readonly fileHintPreview?: string};
  VFS_DIRECTORY_NOT_EMPTY: {readonly path: string};
  VFS_INVALID_PATH: {readonly path: string; readonly reason?: string | CoreMessageDescriptor};
  VFS_INVALID_NAME: {readonly path: string; readonly reason?: string | CoreMessageDescriptor};
  VFS_IS_DIRECTORY: {readonly path: string};
  VFS_ALREADY_EXISTS: {readonly path: string};
  VFS_NOT_A_DIRECTORY: {readonly path: string};
  VFS_PARENT_NOT_FOUND: {readonly path: string};
  VFS_INVALID_PATTERN: {readonly pattern: string};
  VFS_CHARACTER_CARD_UNSUPPORTED_SPEC: {readonly spec: string};
  TOOL_SEARCH_TEMPLATE_INVALID: {readonly reason: string};
  TOOL_NOT_FOUND: {readonly toolName: string};
  TOOL_CONFLICT: {readonly toolName: string};
  TOOL_INVALID_ARGUMENT: {readonly toolName: string; readonly issues?: readonly ZodIssue[]};
  TOOL_FAILED: {readonly toolName: string; readonly cause?: unknown};
  TOOL_FORBIDDEN: {readonly toolName: string; readonly path: string};
  PROVIDER_NOT_FOUND: {readonly providerId: string};
  PROVIDER_SAVED_MODEL_IN_USE: {readonly modelName: string; readonly blockingRefs: string};
  CHAT_NOT_FOUND: {readonly kind: string; readonly id: string; readonly messageId?: string; readonly projectId?: string; readonly sessionId?: string};
  SKILL_INVALID_NAME: {readonly skillName: string; readonly reason: string | CoreMessageDescriptor};
  SKILL_INVALID_PATH: {readonly path: string; readonly reason?: string | CoreMessageDescriptor};
  SKILL_MISSING_DOMAIN: {readonly skillName: string};
  SKILL_MISSING_PROJECT_ID: {readonly skillName: string};
  SKILL_NOT_FOUND: {readonly skillName: string; readonly path?: string};
  SKILL_BUILTIN: {readonly skillName: string};
  SKILL_BUILTIN_NAME_RESERVED: {readonly skillName: string};
  SKILL_BUILTIN_RENAME: {readonly skillName: string};
  SKILL_ALREADY_EXISTS: {readonly skillName: string};
  SESSION_FS_ROLLBACK_MESSAGE_NOT_FOUND: {readonly messageId: string; readonly sessionId?: string; readonly logicalPath?: string};
  SESSION_FS_ROLLBACK_MESSAGE_SESSION_MISMATCH: {readonly messageId: string; readonly sessionId?: string};
  SESSION_FS_RESTORE_REVISION_MISSING: {readonly logicalPath: string; readonly revisionVersion: number; readonly sessionId?: string; readonly messageId?: string};
  SESSION_FS_ROLLBACK_NO_CHECKPOINT: {readonly messageId?: string; readonly sessionId?: string};
  SESSION_FS_ROLLBACK_VFS_RESTORE_FAILED: {readonly sessionId?: string; readonly messageId?: string; readonly logicalPath?: string};
  SESSION_FS_ROLLBACK_REVISION_BACKFILL_REQUIRED: {readonly missingLogicalPaths: string; readonly sessionId?: string; readonly messageId?: string};
  SESSION_FS_ROLLBACK_CONFLICT: {readonly expectedMessageCount: number; readonly actualMessageCount: number; readonly sessionId?: string; readonly messageId?: string};
  SESSION_FS_ROLLBACK_TAIL_DRIFT: {readonly expectedMessageCount: number; readonly actualMessageCount: number; readonly sessionId?: string; readonly messageId?: string};
  PROMPT_INVALID_YAML: {readonly offset?: number};
  PROMPT_INVALID_BLOCK: {readonly offset?: number};
  PROMPT_UNKNOWN_FIELD: {readonly offset?: number};
  PROMPT_UNSUPPORTED_SYNTAX: {readonly offset?: number};
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

  constructor(key: K, params?: ErrorParams<K>, options?: ErrorOptions);
  /** 过渡期旧签名：message 为字符串时塞进 params.detail，为 descriptor 时作为 descriptor 成员。 */
  constructor(key: K, message?: string | CoreMessageDescriptor, details?: Record<string, unknown>, options?: ErrorOptions);
  constructor(key: K, paramsOrMessage?: ErrorParams<K> | string | CoreMessageDescriptor, detailsOrOptions?: Record<string, unknown> | ErrorOptions, legacyOptions?: ErrorOptions) {
    const legacy = typeof paramsOrMessage === "string" || isCoreMessageDescriptor(paramsOrMessage);
    const params = (legacy
      ? {...(typeof paramsOrMessage === "string" ? {detail: paramsOrMessage} : {descriptor: paramsOrMessage}), ...(detailsOrOptions as Record<string, unknown> | undefined)}
      : paramsOrMessage) as ErrorParams<K> | undefined;
    const options = (legacy ? legacyOptions : detailsOrOptions) as ErrorOptions | undefined;
    const def: ErrorCodeDef = ErrorCodes[key];
    // 旧签名的字符串 message 不得从 details 里「捡」descriptor（既有行为：字符串通道不带 messageKey）。
    const descriptor = typeof paramsOrMessage === "string" ? undefined : firstDescriptorOf(params);
    super(params?.detail ?? def.desc, {cause: (params as {cause?: unknown} | undefined)?.cause ?? options?.cause});
    this.name = key;
    this.key = key;
    this.code = ErrorCodes[key].code;
    this.desc = def.desc;
    this.messageKey = descriptor?.key ?? def.messageKey;
    // descriptor 命中时 messageParams 只取 descriptor.params（为空即 undefined，与旧 VfsError
    // wire 一致）；不再回退 toSnakeCase(params)——那会把 descriptor 对象自身当参数透传出去。
    this.messageParams = descriptor != null ? descriptor.params : (params == null ? undefined : toSnakeCase(params as Record<string, unknown>) as MessageParams);
    this.details = legacy ? detailsOrOptions as Record<string, unknown> | undefined : params as Record<string, unknown> | undefined;
  }

  toJSON(): AppErrorWire {
    return {key: this.key, code: this.code, desc: this.desc, message: this.message, ...(this.messageKey == null ? {} : {messageKey: this.messageKey, messageParams: this.messageParams}), details: this.details};
  }
}

/** `instanceof` 收窄；给了 key 时再校一次业务码，并把 key 收窄到该字面量。 */
export function isAppError<K extends ErrorKey = ErrorKey>(error: unknown, key?: K): error is AppError<K> {
  return error instanceof AppError && (key === undefined || error.key === key);
}
