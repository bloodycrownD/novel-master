/**
 * Strict parse/validate for `content_json` message bodies.
 *
 * @module domain/chat/content/parse-message-content
 */

import { chatInvalidArgument } from "@/errors/chat-errors.js";
import type {
  ContentBlock,
  ImageBlock,
  ImageSource,
  MessageContent,
  ReadResultRef,
  RedactedThinkingBlock,
  SkillResultRef,
  SkillToolRef,
  TextBlock,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "../model/content-block.js";

const LEGACY_SHAPE_MSG =
  "Legacy message content shape is not supported; use { blocks: [...] }";

const BLOCK_TYPES = new Set([
  "text",
  "image",
  "tool_use",
  "tool_result",
  "thinking",
  "redacted_thinking",
]);

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解析 `meta.skillRef`（skill 跳转三元组）：字段不合法时抛错，
 * 缺省/未携带时返回 undefined（与其他具名 meta 字段同一口径）。
 */
function parseSkillRefMeta(
  value: unknown,
  label: string
): SkillToolRef | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw chatInvalidArgument(`${label}: meta.skillRef must be an object`);
  }
  const domain = value.domain;
  if (domain !== "global" && domain !== "project") {
    throw chatInvalidArgument(
      `${label}: meta.skillRef.domain must be "global" or "project"`
    );
  }
  const name = requireString(value, "name", `${label} meta.skillRef`);
  const projectId = optionalString(value.projectId);
  return {
    domain,
    name,
    ...(projectId != null ? { projectId } : {}),
  };
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  label: string
): string {
  const v = obj[key];
  if (typeof v !== "string" || v === "") {
    throw chatInvalidArgument(`${label}: ${key} must be a non-empty string`);
  }
  return v;
}

/** 必填非负整数（contentRef 数值字段共用口径）。 */
function requireNonNegativeInt(
  obj: Record<string, unknown>,
  key: string,
  label: string
): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw chatInvalidArgument(
      `${label}: ${key} must be a non-negative integer`
    );
  }
  return v;
}

/** 可选非负整数：字段不存在时返回 undefined；存在但类型非法时抛错。 */
function optionalNonNegativeInt(
  obj: Record<string, unknown>,
  key: string,
  label: string
): number | undefined {
  if (!(key in obj)) {
    return undefined;
  }
  return requireNonNegativeInt(obj, key, label);
}

/**
 * 解析 `contentRef`（工具结果引用：read / skill）。
 *
 * **先按 `kind` 分派**：skill 引用带 `kind: "skill"`，read 引用**缺省即
 * read**（存量 content_json 与本分支之前的 read 引用块都没有 `kind` 键，
 * 零迁移兼容）。分派必须在各自白名单之前——否则 read 白名单会静默吞掉
 * skill ref 的 `action/domain/name/files`；过渡期兜底 hydrate 只按
 * `(entryId, version)` 取明文、不消费这些派生字段，但字段被吞会让白名单
 * 语义失真、清理轮无从复原。
 *
 * 与 `meta.skillRef` 同一口径：缺省/未携带时返回 undefined；存在但字段
 * 不合法时抛错——引用字段被静默丢弃会让 hydrate 悬空（wire 缺全文），
 * 宁可拒收（fail-fast）也不丢字段。
 */
function parseContentRef(
  value: unknown,
  label: string
): ReadResultRef | SkillResultRef | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw chatInvalidArgument(`${label}: contentRef must be an object`);
  }
  if (value.kind === "skill") {
    return parseSkillResultRef(value, label);
  }
  return parseReadResultRef(value, label);
}

/**
 * 解析 read 引用（read-tool-result-ref）。
 *
 * `kind` 缺省或 `"read"` 均走本分支（`kind` 若为其它字符串则 fail-fast——
 * 未知 kind 不能静默当 read 处理，那会按 read 白名单解析 skill ref）。
 */
function parseReadResultRef(
  value: Record<string, unknown>,
  label: string
): ReadResultRef {
  const refLabel = `${label} contentRef`;
  const kind = value.kind;
  if (kind !== undefined && kind !== "read") {
    throw chatInvalidArgument(
      `${refLabel}: kind must be "read" or "skill"`
    );
  }
  const path = requireString(value, "path", refLabel);
  const entryId = requireNonNegativeInt(value, "entryId", refLabel);
  const version = requireNonNegativeInt(value, "version", refLabel);
  const contentHash = requireString(value, "contentHash", refLabel);
  const totalBytes = requireNonNegativeInt(value, "totalBytes", refLabel);
  const offset = requireNonNegativeInt(value, "offset", refLabel);
  const limit = optionalNonNegativeInt(value, "limit", refLabel);
  const returnedLines = requireNonNegativeInt(
    value,
    "returnedLines",
    refLabel
  );
  const totalLines = requireNonNegativeInt(value, "totalLines", refLabel);
  if (typeof value.truncated !== "boolean") {
    throw chatInvalidArgument(
      `${refLabel}: truncated must be a boolean`
    );
  }
  const truncated = value.truncated;
  if (
    "lastLineTruncated" in value &&
    typeof value.lastLineTruncated !== "boolean"
  ) {
    throw chatInvalidArgument(
      `${refLabel}: lastLineTruncated must be a boolean`
    );
  }
  const lastLineTruncated =
    value.lastLineTruncated === true ? true : undefined;
  const nextOffset = optionalNonNegativeInt(value, "nextOffset", refLabel);
  // **有意的不对称：不回构 `kind`**。`kind` 只由 skill 侧产出（判别字段，
  // skill 引用必带），read 侧恒缺省——存量 content_json 与本分支之前的 read
  // 引用块都没有该键，「缺省即 read」就是全链窄化口径（见
  // {@link ReadResultRef.kind}）。这里若按 `kind === "read"` 回构出一个
  // `kind: "read"`，落库 JSON 会凭空多一个键、round-trip 不再逐键稳定，
  // 还会让「哪些块带 kind」这条判别规则退化成「read 也可能带」。显式带
  // `kind: "read"` 的输入同样不回构（键被白名单消化，语义仍归 read）。
  return {
    path,
    entryId,
    version,
    contentHash,
    totalBytes,
    offset,
    ...(limit != null ? { limit } : {}),
    returnedLines,
    totalLines,
    truncated,
    ...(lastLineTruncated != null ? { lastLineTruncated } : {}),
    ...(nextOffset != null ? { nextOffset } : {}),
  };
}

/**
 * 解析 skill 引用（skill-result-ref）：逐字段 fail-fast，口径与
 * {@link parseReadResultRef} 一致。`action` / `domain` / `files` 三字段是
 * read 白名单没有的，必须在此显式回构——漏一项就静默丢字段。
 */
function parseSkillResultRef(
  value: Record<string, unknown>,
  label: string
): SkillResultRef {
  const refLabel = `${label} contentRef`;
  const action = value.action;
  if (action !== "load" && action !== "read") {
    throw chatInvalidArgument(
      `${refLabel}: action must be "load" or "read"`
    );
  }
  const domain = value.domain;
  if (domain !== "global" && domain !== "project") {
    throw chatInvalidArgument(
      `${refLabel}: domain must be "global" or "project"`
    );
  }
  const name = requireString(value, "name", refLabel);
  const path = requireString(value, "path", refLabel);
  const entryId = requireNonNegativeInt(value, "entryId", refLabel);
  const version = requireNonNegativeInt(value, "version", refLabel);
  const contentHash = requireString(value, "contentHash", refLabel);
  const totalBytes = requireNonNegativeInt(value, "totalBytes", refLabel);
  const offset = requireNonNegativeInt(value, "offset", refLabel);
  const limit = optionalNonNegativeInt(value, "limit", refLabel);
  const returnedLines = requireNonNegativeInt(
    value,
    "returnedLines",
    refLabel
  );
  const totalLines = requireNonNegativeInt(value, "totalLines", refLabel);
  if (typeof value.truncated !== "boolean") {
    throw chatInvalidArgument(`${refLabel}: truncated must be a boolean`);
  }
  const truncated = value.truncated;
  const nextOffset = optionalNonNegativeInt(value, "nextOffset", refLabel);
  const files = value.files;
  if (!Array.isArray(files) || files.some((f) => typeof f !== "string")) {
    throw chatInvalidArgument(
      `${refLabel}: files must be an array of strings`
    );
  }
  return {
    kind: "skill",
    action,
    domain,
    name,
    path,
    entryId,
    version,
    contentHash,
    totalBytes,
    offset,
    ...(limit != null ? { limit } : {}),
    returnedLines,
    totalLines,
    truncated,
    ...(nextOffset != null ? { nextOffset } : {}),
    files: files as string[],
  };
}

function parseImageSource(value: unknown): ImageSource {
  if (!isRecord(value)) {
    throw chatInvalidArgument("image block: source must be an object");
  }
  const kind = value.kind;
  if (kind === "url") {
    const url = requireString(value, "url", "image url source");
    return { kind: "url", url };
  }
  if (kind === "base64") {
    const mediaType = requireString(value, "mediaType", "image base64 source");
    const data = requireString(value, "data", "image base64 source");
    return { kind: "base64", mediaType, data };
  }
  throw chatInvalidArgument(
    'image block: source.kind must be "url" or "base64"'
  );
}

/**
 * Drop legacy empty `text` blocks (reasoning-only GLM append briefly wrote `text: ""`).
 * Applied on read and before append validation.
 */
function parseBlocksArray(rawBlocks: unknown[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const raw = rawBlocks[i];
    if (isRecord(raw) && raw.type === "text") {
      const text = raw.text;
      if (typeof text !== "string" || text === "") {
        continue;
      }
    }
    blocks.push(parseBlock(raw, i));
  }
  return blocks;
}

function parseBlock(value: unknown, index: number): ContentBlock {
  if (!isRecord(value)) {
    throw chatInvalidArgument(`blocks[${index}]: must be an object`);
  }
  const type = value.type;
  if (typeof type !== "string" || !BLOCK_TYPES.has(type)) {
    throw chatInvalidArgument(
      `blocks[${index}]: unknown or missing type (expected text|image|tool_use|tool_result|thinking|redacted_thinking)`
    );
  }

  switch (type) {
    case "text": {
      const text = requireString(value, "text", `blocks[${index}] text`);
      return { type: "text", text } satisfies TextBlock;
    }
    case "image": {
      const source = parseImageSource(value.source);
      return { type: "image", source } satisfies ImageBlock;
    }
    case "tool_use": {
      const id = requireString(value, "id", `blocks[${index}] tool_use`);
      const name = requireString(value, "name", `blocks[${index}] tool_use`);
      const input = value.input;
      if (!isRecord(input)) {
        throw chatInvalidArgument(
          `blocks[${index}] tool_use: input must be an object`
        );
      }
      const thinkingSignature = optionalString(value.thinkingSignature);
      return {
        type: "tool_use",
        id,
        name,
        input,
        ...(thinkingSignature != null ? { thinkingSignature } : {}),
      } satisfies ToolUseBlock;
    }
    case "tool_result": {
      const label = `blocks[${index}] tool_result`;
      const toolUseId = requireString(value, "toolUseId", label);
      const content = typeof value.content === "string" ? value.content : "";
      if ("ok" in value && typeof value.ok !== "boolean") {
        throw chatInvalidArgument(`${label}: ok must be a boolean`);
      }
      if ("summary" in value && typeof value.summary !== "string") {
        throw chatInvalidArgument(`${label}: summary must be a string`);
      }
      // meta 同 summary/ok 语义：UI-only 旁路字段，允许不存在。
      // 存在时必须是 record；具名称字段类型检查，未知字段静默忽略（向前兼容）。
      let meta:
        | {
            subagentSessionId?: string;
            skillRef?: SkillToolRef;
          }
        | undefined;
      if ("meta" in value && value.meta !== undefined) {
        const metaValue = value.meta;
        if (!isRecord(metaValue)) {
          throw chatInvalidArgument(`${label}: meta must be an object`);
        }
        if (
          "subagentSessionId" in metaValue &&
          typeof metaValue.subagentSessionId !== "string"
        ) {
          throw chatInvalidArgument(
            `${label}: meta.subagentSessionId must be a string`
          );
        }
        const skillRef = parseSkillRefMeta(metaValue.skillRef, label);
        const subagentSessionId = optionalString(metaValue.subagentSessionId);
        meta =
          subagentSessionId != null || skillRef != null
            ? {
                ...(subagentSessionId != null ? { subagentSessionId } : {}),
                ...(skillRef != null ? { skillRef } : {}),
              }
            : undefined;
      }
      const ok = optionalBoolean(value.ok);
      const summary = optionalString(value.summary);
      // contentRef（工具结果引用，read-tool-result-ref / skill-result-ref）：
      // 回构白名单必须补上——parse 只回构显式列出的字段，静默丢弃会让
      // round-trip 丢引用（failureReason 已有丢失先例）。缺省时 undefined
      // （legacy 兼容）。
      const contentRef = parseContentRef(value.contentRef, label);
      return {
        type: "tool_result",
        toolUseId,
        content,
        ...(ok !== undefined ? { ok } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(meta !== undefined ? { meta } : {}),
        ...(contentRef !== undefined ? { contentRef } : {}),
      } satisfies ToolResultBlock;
    }
    case "thinking": {
      const text = typeof value.text === "string" ? value.text : "";
      const thinkingSignature = optionalString(value.thinkingSignature);
      if (text === "" && thinkingSignature == null) {
        throw chatInvalidArgument(
          `blocks[${index}] thinking: text or thinkingSignature required`
        );
      }
      return {
        type: "thinking",
        text,
        ...(thinkingSignature != null ? { thinkingSignature } : {}),
      } satisfies ThinkingBlock;
    }
    case "redacted_thinking": {
      const data = requireString(
        value,
        "data",
        `blocks[${index}] redacted_thinking`
      );
      const thinkingSignature = optionalString(value.thinkingSignature);
      return {
        type: "redacted_thinking",
        data,
        ...(thinkingSignature != null ? { thinkingSignature } : {}),
      } satisfies RedactedThinkingBlock;
    }
    default:
      throw chatInvalidArgument(`blocks[${index}]: unsupported type`);
  }
}

/** Runtime validation for in-memory {@link MessageContent} before append. */
export function assertMessageContent(
  value: unknown
): asserts value is MessageContent {
  if (!isRecord(value)) {
    throw chatInvalidArgument("MessageContent must be an object");
  }
  if ("content" in value || "parts" in value) {
    throw chatInvalidArgument(LEGACY_SHAPE_MSG);
  }
  const extraKeys = Object.keys(value).filter((k) => k !== "blocks");
  if (extraKeys.length > 0) {
    throw chatInvalidArgument(
      `MessageContent has unexpected keys: ${extraKeys.join(", ")}`
    );
  }
  if (!("blocks" in value)) {
    throw chatInvalidArgument("MessageContent must have a blocks array");
  }
  if (!Array.isArray(value.blocks)) {
    throw chatInvalidArgument("MessageContent.blocks must be an array");
  }
  (value as { blocks: ContentBlock[] }).blocks = parseBlocksArray(value.blocks);
}

/** Parse and validate JSON from `content_json`. */
export function parseMessageContent(json: string): MessageContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw chatInvalidArgument("Invalid JSON in message content");
  }
  assertMessageContent(parsed);
  return parsed;
}
