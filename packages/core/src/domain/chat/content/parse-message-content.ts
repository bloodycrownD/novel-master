/**
 * Strict parse/validate for `content_json` message bodies.
 *
 * 纯校验/解码函数不抛错：失败一律通过 `Result<..., AppError>` 返回
 * （key `CHAT_INVALID_ARGUMENT`），由 service / repository / CLI 边界决定
 * 是否 throw。
 *
 * @module domain/chat/content/parse-message-content
 */

import { isRecord } from "@/common/guards.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type {
  ContentBlock,
  ImageBlock,
  MessageContent,
  RedactedThinkingBlock,
  SkillToolRef,
  TextBlock,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "../model/content-block.js";

type ContentError = AppError<"CHAT_INVALID_ARGUMENT">;

/** 多处复用的字符串字段校验；失败文案统一带 label/key。 */
function requireString(obj: Record<string, unknown>, key: string, label: string): Result<string, ContentError> {
  const v = obj[key];
  return typeof v === "string" && v !== "" ? Result.ok(v) : Result.err(new AppError("CHAT_INVALID_ARGUMENT", `${label}: ${key} must be a non-empty string`));
}

/** Runtime validation for untrusted in-memory {@link MessageContent} before append. */
export function parseMessageContentValue(value: unknown): Result<MessageContent, ContentError> {
  if (!isRecord(value)) {
    return Result.err(new AppError("CHAT_INVALID_ARGUMENT", "MessageContent must be an object"));
  }
  if ("content" in value || "parts" in value) {
    return Result.err(new AppError("CHAT_INVALID_ARGUMENT", "Legacy message content shape is not supported; use { blocks: [...] }"));
  }
  const extraKeys = Object.keys(value).filter((k) => k !== "blocks");
  if (extraKeys.length > 0) {
    return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `MessageContent has unexpected keys: ${extraKeys.join(", ")}`));
  }
  if (!Array.isArray(value.blocks)) {
    return Result.err(new AppError("CHAT_INVALID_ARGUMENT", "MessageContent.blocks must be an array"));
  }

  const blocks: ContentBlock[] = [];
  for (const [index, raw] of value.blocks.entries()) {
    if (!isRecord(raw)) {
      return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `blocks[${index}]: must be an object`));
    }

    switch (raw.type) {
      case "text": {
        const text = raw.text;
        // 历史空 text 块直接丢弃（reasoning-only GLM append 曾短暂写入 text: ""）。
        if (typeof text === "string" && text !== "") {
          blocks.push({ type: "text", text } satisfies TextBlock);
        }
        continue;
      }
      case "image": {
        const source = raw.source;
        if (!isRecord(source)) {
          return Result.err(new AppError("CHAT_INVALID_ARGUMENT", "image block: source must be an object"));
        }
        if (source.kind === "url") {
          const url = requireString(source, "url", "image url source");
          if (!url.ok) {
            return Result.err(url.error);
          }
          blocks.push({ type: "image", source: { kind: "url", url: url.value } } satisfies ImageBlock);
          continue;
        }
        if (source.kind === "base64") {
          const mediaType = requireString(source, "mediaType", "image base64 source");
          if (!mediaType.ok) {
            return Result.err(mediaType.error);
          }
          const data = requireString(source, "data", "image base64 source");
          if (!data.ok) {
            return Result.err(data.error);
          }
          blocks.push({ type: "image", source: { kind: "base64", mediaType: mediaType.value, data: data.value } } satisfies ImageBlock);
          continue;
        }
        return Result.err(new AppError("CHAT_INVALID_ARGUMENT", 'image block: source.kind must be "url" or "base64"'));
      }
      case "tool_use": {
        const id = requireString(raw, "id", `blocks[${index}] tool_use`);
        if (!id.ok) {
          return Result.err(id.error);
        }
        const name = requireString(raw, "name", `blocks[${index}] tool_use`);
        if (!name.ok) {
          return Result.err(name.error);
        }
        const input = raw.input;
        if (!isRecord(input)) {
          return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `blocks[${index}] tool_use: input must be an object`));
        }
        const thinkingSignature = typeof raw.thinkingSignature === "string" && raw.thinkingSignature !== "" ? raw.thinkingSignature : undefined;
        blocks.push({
          type: "tool_use",
          id: id.value,
          name: name.value,
          input,
          ...(thinkingSignature != null ? { thinkingSignature } : {}),
        } satisfies ToolUseBlock);
        continue;
      }
      case "tool_result": {
        const label = `blocks[${index}] tool_result`;
        const toolUseId = requireString(raw, "toolUseId", label);
        if (!toolUseId.ok) {
          return Result.err(toolUseId.error);
        }
        const content = typeof raw.content === "string" ? raw.content : "";
        if ("ok" in raw && typeof raw.ok !== "boolean") {
          return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `${label}: ok must be a boolean`));
        }
        if ("summary" in raw && typeof raw.summary !== "string") {
          return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `${label}: summary must be a string`));
        }
        // meta 同 summary/ok 语义：UI-only 旁路字段，允许不存在。
        // 存在时必须是 record；具名称字段类型检查，未知字段静默忽略（向前兼容）。
        let meta: ToolResultBlock["meta"];
        const metaValue = raw.meta;
        if (metaValue !== undefined) {
          if (!isRecord(metaValue)) {
            return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `${label}: meta must be an object`));
          }
          if ("subagentSessionId" in metaValue && typeof metaValue.subagentSessionId !== "string") {
            return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `${label}: meta.subagentSessionId must be a string`));
          }
          const subagentSessionId = typeof metaValue.subagentSessionId === "string" && metaValue.subagentSessionId !== "" ? metaValue.subagentSessionId : undefined;
          let skillRef: SkillToolRef | undefined;
          const skillRefValue = metaValue.skillRef;
          if (skillRefValue !== undefined) {
            if (!isRecord(skillRefValue)) {
              return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `${label}: meta.skillRef must be an object`));
            }
            const domain = skillRefValue.domain;
            if (domain !== "global" && domain !== "project") {
              return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `${label}: meta.skillRef.domain must be "global" or "project"`));
            }
            const name = requireString(skillRefValue, "name", `${label} meta.skillRef`);
            if (!name.ok) {
              return Result.err(name.error);
            }
            const projectId = typeof skillRefValue.projectId === "string" && skillRefValue.projectId !== "" ? skillRefValue.projectId : undefined;
            skillRef = { domain, name: name.value, ...(projectId != null ? { projectId } : {}) };
          }
          if (subagentSessionId != null || skillRef != null) {
            meta = {
              ...(subagentSessionId != null ? { subagentSessionId } : {}),
              ...(skillRef != null ? { skillRef } : {}),
            };
          }
        }
        const ok = typeof raw.ok === "boolean" ? raw.ok : undefined;
        const summary = typeof raw.summary === "string" && raw.summary !== "" ? raw.summary : undefined;
        // contentRef（工具结果引用）白名单已随 E1 清理版退役；存量行若仍带该键，
        // 按未知字段静默忽略（内容取不回，读到的是回迁后正文或错误占位）。
        blocks.push({
          type: "tool_result",
          toolUseId: toolUseId.value,
          content,
          ...(ok !== undefined ? { ok } : {}),
          ...(summary !== undefined ? { summary } : {}),
          ...(meta !== undefined ? { meta } : {}),
        } satisfies ToolResultBlock);
        continue;
      }
      case "thinking": {
        const text = typeof raw.text === "string" ? raw.text : "";
        const thinkingSignature = typeof raw.thinkingSignature === "string" && raw.thinkingSignature !== "" ? raw.thinkingSignature : undefined;
        if (text === "" && thinkingSignature == null) {
          return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `blocks[${index}] thinking: text or thinkingSignature required`));
        }
        blocks.push({
          type: "thinking",
          text,
          ...(thinkingSignature != null ? { thinkingSignature } : {}),
        } satisfies ThinkingBlock);
        continue;
      }
      case "redacted_thinking": {
        const data = requireString(raw, "data", `blocks[${index}] redacted_thinking`);
        if (!data.ok) {
          return Result.err(data.error);
        }
        const thinkingSignature = typeof raw.thinkingSignature === "string" && raw.thinkingSignature !== "" ? raw.thinkingSignature : undefined;
        blocks.push({
          type: "redacted_thinking",
          data: data.value,
          ...(thinkingSignature != null ? { thinkingSignature } : {}),
        } satisfies RedactedThinkingBlock);
        continue;
      }
      default:
        return Result.err(new AppError("CHAT_INVALID_ARGUMENT", `blocks[${index}]: unknown or missing type (expected text|image|tool_use|tool_result|thinking|redacted_thinking)`));
    }
  }
  return Result.ok({ blocks });
}

/** Parse and validate JSON from `content_json`. */
export function parseMessageContent(json: string): Result<MessageContent, ContentError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return Result.err(new AppError("CHAT_INVALID_ARGUMENT", "Invalid JSON in message content"));
  }
  return parseMessageContentValue(parsed);
}
