/**
 * 日志脱敏（内部实现）：key 黑名单、正文摘要、三重截断。
 *
 * 只在 core emit 时统一执行一次——任何 sink（含未来的 IPC sink）拿到的
 * 都是已脱敏记录，原文不出 core。
 *
 * 对外只经 `@novel-master/core/log` 暴露 {@link describeText}；
 * {@link toLogRecord} 是 logger 的模块间协作面（emit 的唯一入口）。
 *
 * @module infra/log/sanitize-log
 */

import { utf8ByteLength } from "@/common/encoding.js";
import { fnv1aHex16 } from "@/common/hash.js";
import type { LogDetail, LogLevel, LogRecord } from "./log-record.js";

/** message 上限（不做内容扫描——call site 不得把正文插值进 message）。 */
const MESSAGE_MAX_CHARS = 500;
/** 普通字符串值上限；超长追加 `…(+N)`，总长落在 400 + 5。 */
const STRING_MAX_CHARS = 400;
/** 数组保留项数。 */
const ARRAY_MAX_ITEMS = 20;
/** 单对象保留键数。 */
const OBJECT_MAX_KEYS = 50;
/** detail 最大嵌套深度：detail 本体算第 0 层，第 5 层起落 `[depth-limit]`。 */
const MAX_DEPTH = 4;
/** 单条 detail 序列化后的字节上限。 */
const DETAIL_MAX_BYTES = 8 * 1024;
/** Error.message 上限。 */
const ERROR_MESSAGE_MAX_CHARS = 500;
/** Error.stack 上限。 */
const ERROR_STACK_MAX_CHARS = 2_000;

/** 整键归一化后命中即脱敏（词元拼回、去分隔符）。 */
const SECRET_WHOLE_KEYS = new Set(["token", "secret", "password", "passwd", "authorization", "auth", "cookie", "credential", "credentials"]);
/** 相邻词元拼接命中即脱敏。 */
const SECRET_KEY_PAIRS = new Set(["apikey", "accesskey", "secretkey", "privatekey", "sessionkey", "accesstoken", "refreshtoken", "idtoken", "bearertoken", "authtoken"]);
/** 任一词元命中即脱敏。`token` 刻意不进这里——`tokenCount` / `maxTokens` 不该误伤。 */
const SECRET_WORDS = new Set(["password", "passwd", "authorization", "secret", "credential", "credentials", "cookie"]);
/** 正文键：字符串值一律压成 `{chars, hash}`。 */
const BODY_KEYS = new Set(["prompt", "content", "body", "text", "message", "input", "output", "messages", "completion", "chunk", "delta", "reasoning"]);

/** 截断到 `maxChars` 并追加 `…(+N)`；未超长原样返回。 */
function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…(+${text.length - maxChars})`;
}

/**
 * 公开 API：把一段正文压成「长度 + 指纹」。
 *
 * `hash` 复用 {@link fnv1aHex16}（16 位小写 hex）；`chars` 是 UTF-16 长度，
 * 与调用方原本 `text.length` 口径一致。
 */
export function describeText(text: string): { readonly chars: number; readonly hash: string } {
  return { chars: text.length, hash: fnv1aHex16(text) };
}

/**
 * Error → JSON 安全的扁平字段（name / message / 可选 code / stack）。
 *
 * 不含 cause：cause 只展开一层，由调用方在 `seen` 循环守卫下控制。
 */
function errorFields(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: truncate(error.message, ERROR_MESSAGE_MAX_CHARS) };
  const code = error as { code?: unknown };
  if (typeof code.code === "string" || typeof code.code === "number") {
    out.code = code.code;
  }
  if (error.stack != null) {
    out.stack = truncate(error.stack, ERROR_STACK_MAX_CHARS);
  }
  return out;
}

/**
 * 递归脱敏单个值；`depth` 是该值自身的层号（detail 的直属值为 1）。
 *
 * key 三条规则（整键 / 相邻词对 / 单词元）与正文键摘要都在这里落地——
 * `token` 只进前两条，`tokenCount` / `maxTokens` 不误伤。
 */
// nm-style: keep-local — 递归共享 seen 循环守卫与深度预算：两者必须跨层携带，拆成子函数会让「循环不无限递归 + 第 5 层截断」两个不变量各持一份。
function sanitizeValue(value: unknown, depth: number, seen: Set<object>): unknown {
  if (depth > MAX_DEPTH) {
    return "[depth-limit]";
  }
  if (value == null) {
    return value;
  }
  switch (typeof value) {
    case "string":
      return truncate(value, STRING_MAX_CHARS);
    case "number":
      return Number.isFinite(value) ? value : "[unserializable: number]";
    case "boolean":
      return value;
    case "bigint":
    case "symbol":
    case "function":
      return `[unserializable: ${typeof value}]`;
    default:
      break;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[unserializable: date]" : value.toISOString();
  }
  if (value instanceof Error) {
    if (seen.has(value)) {
      return "[unserializable: cycle]";
    }
    seen.add(value);
    const fields = errorFields(value);
    const cause = value.cause;
    if (cause instanceof Error && !seen.has(cause)) {
      seen.add(cause);
      fields.cause = errorFields(cause);
      seen.delete(cause);
    }
    seen.delete(value);
    return fields;
  }
  if (seen.has(value)) {
    return "[unserializable: cycle]";
  }
  seen.add(value);
  let sanitized: unknown;
  if (Array.isArray(value)) {
    const items = value.slice(0, ARRAY_MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
    if (value.length > ARRAY_MAX_ITEMS) {
      items.push({ __truncated: value.length - ARRAY_MAX_ITEMS });
    }
    sanitized = items;
  } else {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    const out: Record<string, unknown> = {};
    for (const key of keys.slice(0, OBJECT_MAX_KEYS)) {
      const entryValue = source[key];
      // key 切词：camelCase / PascalCase 边界与 `_` / `-` 都算分隔。
      const tokens = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter((token) => token.length > 0).map((token) => token.toLowerCase());
      const sensitive = SECRET_WHOLE_KEYS.has(tokens.join("")) || tokens.some((token, index) => SECRET_WORDS.has(token) || (index > 0 && SECRET_KEY_PAIRS.has(`${tokens[index - 1]}${token}`)));
      if (sensitive) {
        out[key] = "[redacted]";
      } else if (BODY_KEYS.has(key)) {
        // 正文键：字符串直接摘要；其它形状先序列化（循环引用/大值抛错时就地降级为空摘要）。
        try {
          out[key] = describeText(typeof entryValue === "string" ? entryValue : JSON.stringify(entryValue) ?? "");
        } catch {
          out[key] = describeText("");
        }
      } else {
        out[key] = sanitizeValue(entryValue, depth + 1, seen);
      }
    }
    if (keys.length > OBJECT_MAX_KEYS) {
      out.__truncatedKeys = keys.length - OBJECT_MAX_KEYS;
    }
    sanitized = out;
  }
  seen.delete(value);
  return sanitized;
}

/**
 * emit 入口：message 截断 + detail 脱敏 + 8KB 总量熔断，产出可直接交给
 * 任何 sink 的记录。
 */
// nm-style: keep-local — 内联会把 truncate/sanitizeValue/utf8ByteLength 与三个上限常量一并搬进
// logger.ts，等于把「脱敏策略」和「日志运行时」耦合回一处；这里是脱敏模块的产出边界，保留独立。
export function toLogRecord(level: LogLevel, scope: string, message: string, detail: LogDetail | undefined): LogRecord {
  const safeMessage = truncate(message, MESSAGE_MAX_CHARS);
  if (detail == null) {
    return { ts: Date.now(), level, scope, message: safeMessage };
  }
  const sanitized = sanitizeValue(detail, 0, new Set<object>()) as Record<string, unknown>;
  const bytes = utf8ByteLength(JSON.stringify(sanitized) ?? "");
  return { ts: Date.now(), level, scope, message: safeMessage, detail: bytes > DETAIL_MAX_BYTES ? { __truncated: true, bytes } : sanitized };
}
