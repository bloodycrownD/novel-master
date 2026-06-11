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
  RedactedThinkingBlock,
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

function requireString(obj: Record<string, unknown>, key: string, label: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v === "") {
    throw chatInvalidArgument(`${label}: ${key} must be a non-empty string`);
  }
  return v;
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
  throw chatInvalidArgument('image block: source.kind must be "url" or "base64"');
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
      `blocks[${index}]: unknown or missing type (expected text|image|tool_use|tool_result|thinking|redacted_thinking)`,
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
        throw chatInvalidArgument(`blocks[${index}] tool_use: input must be an object`);
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
      const content =
        typeof value.content === "string" ? value.content : "";
      if ("ok" in value && typeof value.ok !== "boolean") {
        throw chatInvalidArgument(`${label}: ok must be a boolean`);
      }
      if ("summary" in value && typeof value.summary !== "string") {
        throw chatInvalidArgument(`${label}: summary must be a string`);
      }
      const ok = optionalBoolean(value.ok);
      const summary = optionalString(value.summary);
      return {
        type: "tool_result",
        toolUseId,
        content,
        ...(ok !== undefined ? { ok } : {}),
        ...(summary !== undefined ? { summary } : {}),
      } satisfies ToolResultBlock;
    }
    case "thinking": {
      const text = typeof value.text === "string" ? value.text : "";
      const thinkingSignature = optionalString(value.thinkingSignature);
      if (text === "" && thinkingSignature == null) {
        throw chatInvalidArgument(
          `blocks[${index}] thinking: text or thinkingSignature required`,
        );
      }
      return {
        type: "thinking",
        text,
        ...(thinkingSignature != null ? { thinkingSignature } : {}),
      } satisfies ThinkingBlock;
    }
    case "redacted_thinking": {
      const data = requireString(value, "data", `blocks[${index}] redacted_thinking`);
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
export function assertMessageContent(value: unknown): asserts value is MessageContent {
  if (!isRecord(value)) {
    throw chatInvalidArgument("MessageContent must be an object");
  }
  if ("content" in value || "parts" in value) {
    throw chatInvalidArgument(LEGACY_SHAPE_MSG);
  }
  const extraKeys = Object.keys(value).filter((k) => k !== "blocks");
  if (extraKeys.length > 0) {
    throw chatInvalidArgument(
      `MessageContent has unexpected keys: ${extraKeys.join(", ")}`,
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
