/**
 * Bidirectional mapping between NM content blocks and Anthropic API content arrays.
 *
 * @module infra/llm-protocol/logic/anthropic-content-mapper
 */

import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { AnthropicToolNameWire } from "./anthropic-tool-names.js";

type AnthropicContentItem = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** NM blocks ??Anthropic message `content` array. */
export function blocksToAnthropicContent(
  blocks: readonly ContentBlock[],
  toolNames?: AnthropicToolNameWire,
): AnthropicContentItem[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text", text: block.text };
      case "image":
        if (block.source.kind === "url") {
          return {
            type: "image",
            source: { type: "url", url: block.source.url },
          };
        }
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: block.source.mediaType,
            data: block.source.data,
          },
        };
      case "tool_use":
        return {
          type: "tool_use",
          id: block.id,
          name: toolNames?.toWire(block.name) ?? block.name,
          input: block.input,
        };
      case "tool_result":
        return {
          type: "tool_result",
          tool_use_id: block.toolUseId,
          content: block.content,
        };
      case "thinking": {
        const item: AnthropicContentItem = {
          type: "thinking",
          thinking: block.text,
        };
        if (block.thinkingSignature != null) {
          item.signature = block.thinkingSignature;
        }
        return item;
      }
      case "redacted_thinking":
        return { type: "redacted_thinking", data: block.data };
      default:
        return { type: "text", text: "" };
    }
  });
}

/** Anthropic API `content[]` ??NM blocks (unknown types are skipped). */
export function anthropicContentToBlocks(
  content: readonly unknown[],
  toolNames?: AnthropicToolNameWire,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const item of content) {
    if (!isRecord(item) || typeof item.type !== "string") {
      continue;
    }
    switch (item.type) {
      case "text": {
        const text = typeof item.text === "string" ? item.text : "";
        if (text !== "") {
          blocks.push({ type: "text", text });
        }
        break;
      }
      case "image": {
        const source = item.source;
        if (!isRecord(source)) {
          break;
        }
        if (source.type === "url" && typeof source.url === "string") {
          blocks.push({
            type: "image",
            source: { kind: "url", url: source.url },
          });
        } else if (
          source.type === "base64" &&
          typeof source.media_type === "string" &&
          typeof source.data === "string"
        ) {
          blocks.push({
            type: "image",
            source: {
              kind: "base64",
              mediaType: source.media_type,
              data: source.data,
            },
          });
        }
        break;
      }
      case "tool_use":
        if (
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          isRecord(item.input)
        ) {
          blocks.push({
            type: "tool_use",
            id: item.id,
            name: toolNames?.fromWire(item.name) ?? item.name,
            input: item.input,
          });
        }
        break;
      case "tool_result":
        if (typeof item.tool_use_id === "string") {
          blocks.push({
            type: "tool_result",
            toolUseId: item.tool_use_id,
            content: typeof item.content === "string" ? item.content : "",
          });
        }
        break;
      case "thinking": {
        const text =
          typeof item.thinking === "string"
            ? item.thinking
            : typeof item.text === "string"
              ? item.text
              : "";
        const signature =
          typeof item.signature === "string" && item.signature !== ""
            ? item.signature
            : undefined;
        if (text !== "" || signature != null) {
          blocks.push({
            type: "thinking",
            text,
            ...(signature != null ? { thinkingSignature: signature } : {}),
          });
        }
        break;
      }
      case "redacted_thinking": {
        const data = typeof item.data === "string" ? item.data : "";
        const signature =
          typeof item.signature === "string" && item.signature !== ""
            ? item.signature
            : undefined;
        if (data !== "") {
          blocks.push({
            type: "redacted_thinking",
            data,
            ...(signature != null ? { thinkingSignature: signature } : {}),
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return blocks;
}

/** Session history ??Anthropic `messages[]` (tool_result ??user role). */
export function chatMessagesToAnthropic(
  messages: readonly ChatMessage[],
  toolNames?: AnthropicToolNameWire,
): Array<{ role: string; content: AnthropicContentItem[] }> {
  const out: Array<{ role: string; content: AnthropicContentItem[] }> = [];

  for (const msg of messages) {
    const toolResults = msg.content.blocks.filter((b) => b.type === "tool_result");
    const other = msg.content.blocks.filter((b) => b.type !== "tool_result");

    if (toolResults.length > 0) {
      out.push({
        role: "user",
        content: blocksToAnthropicContent(toolResults, toolNames),
      });
    }
    if (other.length > 0) {
      out.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: blocksToAnthropicContent(other, toolNames),
      });
    }
  }

  return out;
}
