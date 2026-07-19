/**
 * Bidirectional mapping between NM content blocks and OpenAI Chat Completions wire format.
 *
 * Pure serialization â€?no HTTP. Used by {@link OpenAiProtocolAdapter} only.
 *
 * @module infra/llm-protocol/logic/openai-content-mapper
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { LlmStreamEvent, DegradedToolCall } from "../ports/adapter.port.js";
import { cleanseReplyTextAndThinking } from "./inline-thinking-parser.js";
import { buildStreamPartialBlocks } from "./stream-partial-blocks.js";
import {
  emitDirectTextDelta,
  feedInlineThinkingAwareTextDelta,
  finishInlineThinkingAwareText,
} from "./inline-thinking-parser.js";
import { inlineStreamThinkingSplitEnabled } from "./stream-inline-thinking-split-mode.js";
import { tryParseToolArgumentsJson } from "./tool-arguments-parse.js";

export type OpenAiChatMessage = Record<string, unknown>;

type OpenAiContentPart = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build NM blocks from accumulated reply strings (normal stream finish).
 * Aligns with {@link buildStreamPartialBlocks}: keep thinking separate; omit empty
 * text blocks (content_json rejects `text: ""`). Thinking-only replies are valid.
 */
function blocksFromReplyStrings(textRaw: string, thinkingRaw: string): ContentBlock[] {
  // Final pass: proxies may duplicate structured reasoning inside content text.
  const { visible: text, thinking } = cleanseReplyTextAndThinking(
    textRaw,
    thinkingRaw,
  );
  const blocks: ContentBlock[] = [];
  if (thinking.trim() !== "") {
    blocks.push({ type: "thinking", text: thinking });
  }
  if (text.trim() !== "") {
    blocks.push({ type: "text", text });
  }
  return blocks;
}

function appendOpenAiStreamTextDelta(
  state: {
    textParts: string[];
    thinkingParts: string[];
    inlineTextSplitter?: import("./inline-thinking-parser.js").InlineThinkingStreamSplitter;
  },
  content: unknown,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  const feedText = inlineStreamThinkingSplitEnabled()
    ? feedInlineThinkingAwareTextDelta
    : emitDirectTextDelta;

  if (typeof content === "string" && content !== "") {
    feedText(state, content, onStream);
    return;
  }
  if (!Array.isArray(content)) {
    return;
  }
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    if (part.type === "text" && typeof part.text === "string" && part.text !== "") {
      feedText(state, part.text, onStream);
    }
  }
}

function imageUrlFromBlock(block: Extract<ContentBlock, { type: "image" }>): string {
  if (block.source.kind === "url") {
    return block.source.url;
  }
  return `data:${block.source.mediaType};base64,${block.source.data}`;
}

/**
 * NM blocks â†?OpenAI message `content` (string or multimodal parts array).
 * `tool_use` / `tool_result` are handled at the message level by {@link chatMessagesToOpenAi}.
 */
export function blocksToOpenAiMessageContent(
  blocks: readonly ContentBlock[],
): string | OpenAiContentPart[] {
  const contentBlocks = blocks.filter(
    (b) => b.type !== "tool_use" && b.type !== "tool_result",
  );
  if (contentBlocks.length === 0) {
    return "";
  }

  const parts: OpenAiContentPart[] = [];
  for (const block of contentBlocks) {
    switch (block.type) {
      case "text":
        if (block.text !== "") {
          parts.push({ type: "text", text: block.text });
        }
        break;
      case "image":
        parts.push({
          type: "image_url",
          image_url: { url: imageUrlFromBlock(block) },
        });
        break;
      case "thinking":
        throw new ProviderError(
          "UNSUPPORTED_CONTENT",
          "OpenAI outbound messages must not include thinking blocks; strip them before mapping",
        );
      default:
        break;
    }
  }

  if (parts.length === 0) {
    return "";
  }
  if (parts.length === 1 && parts[0]!.type === "text") {
    return (parts[0] as { text: string }).text;
  }
  return parts;
}

function toolCallsFromBlocks(
  toolUses: readonly Extract<ContentBlock, { type: "tool_use" }>[],
): unknown[] {
  return toolUses.map((block) => ({
    id: block.id,
    type: "function",
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input),
    },
  }));
}

/**
 * Session history â†?OpenAI `messages[]` (`tool_result` â†?`role: tool`; assistant `tool_use` â†?`tool_calls`).
 */
export function chatMessagesToOpenAi(
  messages: readonly ChatMessage[],
): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];

  for (const msg of messages) {
    const toolResults = msg.content.blocks.filter((b) => b.type === "tool_result");
    const toolUses = msg.content.blocks.filter((b) => b.type === "tool_use");
    const other = msg.content.blocks.filter(
      (b) =>
        b.type !== "tool_result" &&
        b.type !== "tool_use" &&
        b.type !== "thinking",
    );

    for (const tr of toolResults) {
      out.push({
        role: "tool",
        tool_call_id: tr.toolUseId,
        content: tr.content,
      });
    }

    if (other.length > 0 || toolUses.length > 0) {
      const role = msg.role === "assistant" ? "assistant" : "user";
      const message: OpenAiChatMessage = { role };

      if (other.length > 0) {
        const content = blocksToOpenAiMessageContent(other);
        if (content !== "") {
          message.content = content;
        }
      }

      if (toolUses.length > 0) {
        message.tool_calls = toolCallsFromBlocks(toolUses);
        if (message.content == null) {
          message.content = null;
        }
      }

      // 无 content 且无 tool_calls → OpenAI 兼容网关会 400 invalid_request_error
      if (message.content == null && message.tool_calls == null) {
        continue;
      }

      out.push(message);
    }
  }

  return out;
}

/**
 * OpenAI `choices[0].message` (or equivalent) â†?NM {@link ContentBlock} array.
 */
export function openAiChoiceToBlocks(message: unknown): ContentBlock[] {
  if (!isRecord(message)) {
    return [];
  }

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const blocks: ContentBlock[] = [];

  const reasoning = message.reasoning_content;
  if (typeof reasoning === "string" && reasoning !== "") {
    thinkingParts.push(reasoning);
  }

  const content = message.content;
  if (typeof content === "string" && content !== "") {
    const split = cleanseReplyTextAndThinking(content, thinkingParts.join(""));
    if (split.thinking !== "") {
      thinkingParts.length = 0;
      thinkingParts.push(split.thinking);
    }
    if (split.visible !== "") {
      textParts.push(split.visible);
    }
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }
      if (part.type === "text" && typeof part.text === "string" && part.text !== "") {
        textParts.push(part.text);
      } else if (part.type === "image_url" && isRecord(part.image_url)) {
        const url = part.image_url.url;
        if (typeof url === "string" && url !== "") {
          if (url.startsWith("data:")) {
            const match = /^data:([^;]+);base64,(.+)$/.exec(url);
            if (match) {
              blocks.push({
                type: "image",
                source: {
                  kind: "base64",
                  mediaType: match[1]!,
                  data: match[2]!,
                },
              });
            }
          } else {
            blocks.push({
              type: "image",
              source: { kind: "url", url },
            });
          }
        }
      }
    }
  }

  blocks.unshift(
    ...blocksFromReplyStrings(textParts.join(""), thinkingParts.join("")),
  );

  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      if (!isRecord(tc) || tc.type !== "function") {
        continue;
      }
      const fn = tc.function;
      if (!isRecord(fn) || typeof fn.name !== "string") {
        continue;
      }
      const id = typeof tc.id === "string" ? tc.id : "";
      let input: Record<string, unknown> = {};
      if (typeof fn.arguments === "string" && fn.arguments !== "") {
        try {
          input = JSON.parse(fn.arguments) as Record<string, unknown>;
        } catch {
          input = {};
        }
      }
      blocks.push({
        type: "tool_use",
        id,
        name: fn.name,
        input,
      });
    }
  }

  return blocks;
}

function tryEmitOpenAiToolUseIfComplete(
  state: {
    toolCalls: Map<number, ToolCallAccumulator>;
    emittedToolIndices: Set<number>;
  },
  index: number,
  onStream?: (event: LlmStreamEvent) => void,
): void {
  if (state.emittedToolIndices.has(index)) {
    return;
  }
  const acc = state.toolCalls.get(index);
  if (acc == null || acc.name === "" || acc.argumentsJson === "") {
    return;
  }
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(acc.argumentsJson) as Record<string, unknown>;
  } catch {
    return;
  }
  state.emittedToolIndices.add(index);
  onStream?.({ type: "tool-use", id: acc.id, name: acc.name, input });
}

type ToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

/**
 * Apply one OpenAI stream chunk; returns stream events and mutates accumulators.
 * @internal
 */
export function openAiStreamDeltaToEvents(
  delta: unknown,
  state: {
    textParts: string[];
    thinkingParts: string[];
    toolCalls: Map<number, ToolCallAccumulator>;
    emittedToolIndices: Set<number>;
    inlineTextSplitter?: import("./inline-thinking-parser.js").InlineThinkingStreamSplitter;
  },
  onStream?: (event: LlmStreamEvent) => void,
): void {
  if (!isRecord(delta)) {
    return;
  }

  appendOpenAiStreamTextDelta(state, delta.content, onStream);

  const reasoning = delta.reasoning_content;
  if (typeof reasoning === "string" && reasoning !== "") {
    state.thinkingParts.push(reasoning);
    onStream?.({ type: "thinking-delta", text: reasoning });
  }

  const toolCallDeltas = delta.tool_calls;
  if (!Array.isArray(toolCallDeltas)) {
    return;
  }

  for (const tc of toolCallDeltas) {
    if (!isRecord(tc)) {
      continue;
    }
    const index = typeof tc.index === "number" ? tc.index : 0;
    let acc = state.toolCalls.get(index);
    if (acc == null) {
      acc = { id: "", name: "", argumentsJson: "" };
      state.toolCalls.set(index, acc);
    }
    if (typeof tc.id === "string" && tc.id !== "") {
      acc.id = tc.id;
    }
    const fn = tc.function;
    if (isRecord(fn)) {
      if (typeof fn.name === "string" && fn.name !== "") {
        acc.name = fn.name;
      }
      if (typeof fn.arguments === "string" && fn.arguments !== "") {
        acc.argumentsJson += fn.arguments;
      }
    }
    tryEmitOpenAiToolUseIfComplete(state, index, onStream);
  }
}

/** Build final blocks from stream accumulators and emit `tool-use` events. */
export function openAiStreamAccumulatorsToBlocks(
  state: {
    textParts: string[];
    thinkingParts: string[];
    toolCalls: Map<number, ToolCallAccumulator>;
    emittedToolIndices: Set<number>;
    inlineTextSplitter?: import("./inline-thinking-parser.js").InlineThinkingStreamSplitter;
  },
  onStream?: (event: LlmStreamEvent) => void,
): { blocks: ContentBlock[]; degradedToolCalls: DegradedToolCall[] } {
  finishInlineThinkingAwareText(state, onStream);
  const blocks = blocksFromReplyStrings(
    state.textParts.join(""),
    state.thinkingParts.join(""),
  );
  const degradedToolCalls: DegradedToolCall[] = [];

  const indices = [...state.toolCalls.keys()].sort((a, b) => a - b);
  for (const index of indices) {
    const acc = state.toolCalls.get(index)!;
    const parsed = tryParseToolArgumentsJson(acc.argumentsJson);
    let input: Record<string, unknown>;
    if (parsed.ok) {
      input = parsed.value;
    } else {
      input = {};
      degradedToolCalls.push({
        id: acc.id,
        name: acc.name,
        rawArguments: parsed.raw,
        reason: "INVALID_TOOL_ARGUMENTS",
      });
    }
    blocks.push({
      type: "tool_use",
      id: acc.id,
      name: acc.name,
      input,
    });
    if (!state.emittedToolIndices.has(index)) {
      state.emittedToolIndices.add(index);
      onStream?.({
        type: "tool-use",
        id: acc.id,
        name: acc.name,
        input,
      });
    }
  }

  return { blocks, degradedToolCalls };
}

/** Partial stream snapshot on user cancel (see {@link buildStreamPartialBlocks}). */
export function openAiStreamAccumulatorsToPartialBlocks(
  state: {
    textParts: string[];
    thinkingParts: string[];
    toolCalls: Map<number, ToolCallAccumulator>;
    emittedToolIndices: Set<number>;
    inlineTextSplitter?: import("./inline-thinking-parser.js").InlineThinkingStreamSplitter;
  },
  onStream?: (event: LlmStreamEvent) => void,
): ContentBlock[] {
  finishInlineThinkingAwareText(state, onStream);
  const cleansed = cleanseReplyTextAndThinking(
    state.textParts.join(""),
    state.thinkingParts.join(""),
  );
  const blocks = buildStreamPartialBlocks(
    {
      text: cleansed.visible,
      thinking: cleansed.thinking,
    },
    onStream,
  );

  const indices = [...state.toolCalls.keys()].sort((a, b) => a - b);
  for (const index of indices) {
    const acc = state.toolCalls.get(index)!;
    let input: Record<string, unknown> = {};
    if (acc.argumentsJson !== "") {
      try {
        input = JSON.parse(acc.argumentsJson) as Record<string, unknown>;
      } catch {
        input = {};
      }
    }
    blocks.push({
      type: "tool_use",
      id: acc.id,
      name: acc.name,
      input,
    });
    if (!state.emittedToolIndices.has(index)) {
      state.emittedToolIndices.add(index);
      onStream?.({
        type: "tool-use",
        id: acc.id,
        name: acc.name,
        input,
      });
    }
  }
  return blocks;
}
