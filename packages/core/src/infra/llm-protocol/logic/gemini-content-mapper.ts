/**
 * Bidirectional mapping between NM content blocks and Gemini generateContent wire format.
 *
 * @module infra/llm-protocol/logic/gemini-content-mapper
 */

import { messageBodyTextFromBlocks } from "@/domain/chat/content/message-body-text.js";
import { ProviderError } from "@/errors/provider-errors.js";
import type {
  ContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { LlmToolDefinition } from "../ports/adapter.port.js";

type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: string; parts: GeminiPart[] };

export type GeminiPartsToBlocksOptions = {
  /** Latest NM `tool_use.id` per function name (Gemini `functionResponse.name` is the function name, not the call id). */
  readonly toolUseIdByFunctionName?: ReadonlyMap<string, string>;
};

export type ChatMessagesToGeminiContentsOptions = {
  /** Full session history (including hidden) for resolving tool_use id → function name. */
  readonly toolLookupMessages?: readonly ChatMessage[];
  /** Declared tool names on the outbound request (fallback when id equals function name). */
  readonly knownToolNames?: readonly string[];
};

type ToolUseLookup = {
  readonly idToName: ReadonlyMap<string, string>;
  readonly idToUse: ReadonlyMap<string, ToolUseBlock>;
};

type ResolveContext = {
  readonly lookup: ToolUseLookup;
  readonly knownToolNames?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildToolUseLookup(messages: readonly ChatMessage[]): ToolUseLookup {
  const idToName = new Map<string, string>();
  const idToUse = new Map<string, ToolUseBlock>();
  for (const msg of messages) {
    for (const block of msg.content.blocks) {
      if (block.type === "tool_use" && block.name !== "") {
        idToName.set(block.id, block.name);
        idToUse.set(block.id, block);
        // Gemini may echo function name as call id when the API omits functionCall.id.
        idToName.set(block.name, block.name);
        if (!idToUse.has(block.name)) {
          idToUse.set(block.name, block);
        }
      }
    }
  }
  return { idToName, idToUse };
}

/** Resolves tool_use id → declared function name; null when assistant tool_use is unavailable (e.g. compaction). */
function resolveFunctionNameOrNull(
  toolUseId: unknown,
  ctx: ResolveContext,
): string | null {
  if (typeof toolUseId !== "string" || toolUseId.trim() === "") {
    return null;
  }
  const id = toolUseId.trim();
  const mapped = ctx.lookup.idToName.get(id);
  if (mapped != null && mapped !== "") {
    return mapped;
  }
  if (ctx.knownToolNames?.includes(id)) {
    return id;
  }
  return null;
}

function isResolvableToolResult(
  block: ToolResultBlock,
  ctx: ResolveContext,
): boolean {
  return resolveFunctionNameOrNull(block.toolUseId, ctx) != null;
}

function toolResultToGeminiPart(
  block: ToolResultBlock,
  ctx: ResolveContext,
): GeminiPart {
  const functionName = resolveFunctionNameOrNull(block.toolUseId, ctx);
  if (functionName != null) {
    return {
      functionResponse: {
        name: functionName,
        response: { output: block.content },
        id: block.toolUseId,
      },
    };
  }
  // Orphaned after compaction: same plain-text shape as token counting / prompt preview.
  const text = messageBodyTextFromBlocks([block]);
  return { text: text !== "" ? text : "[tool_result]" };
}

function modelTurnCoversToolResults(
  turn: GeminiContent,
  toolResults: readonly ToolResultBlock[],
  ctx: ResolveContext,
): boolean {
  if (turn.role !== "model") {
    return false;
  }
  const calls = turn.parts
    .map((p) => p.functionCall)
    .filter(isRecord)
    .map((fc) => ({
      name: typeof fc.name === "string" ? fc.name : "",
      id: typeof fc.id === "string" ? fc.id : "",
    }))
    .filter((fc) => fc.name !== "");

  for (const block of toolResults) {
    const expectedName = resolveFunctionNameOrNull(block.toolUseId, ctx);
    if (expectedName == null) {
      continue;
    }
    const matched = calls.some(
      (fc) =>
        fc.name === expectedName &&
        (fc.id === "" ||
          fc.id === block.toolUseId ||
          fc.id === expectedName),
    );
    if (!matched) {
      return false;
    }
  }
  return true;
}

function buildSyntheticModelTurn(
  toolResults: readonly ToolResultBlock[],
  ctx: ResolveContext,
): GeminiContent | null {
  const parts: GeminiPart[] = [];
  for (const block of toolResults) {
    const functionName = resolveFunctionNameOrNull(block.toolUseId, ctx);
    if (functionName == null) {
      continue;
    }
    const tu = ctx.lookup.idToUse.get(block.toolUseId);
    parts.push({
      functionCall: {
        name: functionName,
        args: tu?.input ?? {},
        id: tu?.id ?? block.toolUseId,
      },
    });
  }
  if (parts.length === 0) {
    return null;
  }
  return { role: "model", parts };
}

/** NM blocks → Gemini `parts` for one content turn. */
export function blocksToGeminiParts(
  blocks: readonly ContentBlock[],
  ctx: ResolveContext = { lookup: buildToolUseLookup([]) },
): GeminiPart[] {
  const parts: GeminiPart[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text !== "") {
          parts.push({ text: block.text });
        }
        break;
      case "tool_use":
        parts.push({
          functionCall: {
            name: block.name,
            args: block.input,
            id: block.id,
          },
        });
        break;
      case "tool_result":
        parts.push(toolResultToGeminiPart(block, ctx));
        break;
      case "thinking":
        parts.push({ text: block.text, thought: true });
        break;
      case "image":
        throw new ProviderError(
          "UNSUPPORTED_CONTENT",
          "Gemini outbound messages do not support image blocks in this iteration",
        );
      default:
        break;
    }
  }
  return parts;
}

/** Gemini `parts` → NM blocks. */
export function geminiPartsToBlocks(
  parts: readonly unknown[],
  options: GeminiPartsToBlocksOptions = {},
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }
    if (typeof part.text === "string" && part.text !== "") {
      if (part.thought === true) {
        blocks.push({ type: "thinking", text: part.text });
      } else {
        blocks.push({ type: "text", text: part.text });
      }
      continue;
    }
    const functionCall = part.functionCall;
    if (isRecord(functionCall) && typeof functionCall.name === "string") {
      const args = isRecord(functionCall.args) ? functionCall.args : {};
      const id =
        typeof functionCall.id === "string" && functionCall.id !== ""
          ? functionCall.id
          : `${functionCall.name}-${blocks.length}`;
      blocks.push({
        type: "tool_use",
        id,
        name: functionCall.name,
        input: args,
      });
      continue;
    }
    const functionResponse = part.functionResponse;
    if (isRecord(functionResponse) && typeof functionResponse.name === "string") {
      const response = functionResponse.response;
      const content =
        isRecord(response) && typeof response.output === "string"
          ? response.output
          : typeof response === "string"
            ? response
            : JSON.stringify(response ?? "");
      const functionName = functionResponse.name;
      const toolUseId =
        typeof functionResponse.id === "string" && functionResponse.id !== ""
          ? functionResponse.id
          : (options.toolUseIdByFunctionName?.get(functionName) ?? functionName);
      blocks.push({
        type: "tool_result",
        toolUseId,
        content,
      });
    }
  }
  return blocks;
}

/** Session history → Gemini `contents[]`. */
export function chatMessagesToGeminiContents(
  messages: readonly ChatMessage[],
  options: ChatMessagesToGeminiContentsOptions = {},
): GeminiContent[] {
  const out: GeminiContent[] = [];
  const lookupSource =
    options.toolLookupMessages != null && options.toolLookupMessages.length > 0
      ? options.toolLookupMessages
      : messages;
  const ctx: ResolveContext = {
    lookup: buildToolUseLookup(lookupSource),
    knownToolNames: options.knownToolNames,
  };

  for (const msg of messages) {
    const toolResults = msg.content.blocks.filter(
      (b): b is ToolResultBlock => b.type === "tool_result",
    );
    const other = msg.content.blocks.filter((b) => b.type !== "tool_result");

    const resolvable = toolResults.filter((b) => isResolvableToolResult(b, ctx));
    const orphaned = toolResults.filter((b) => !isResolvableToolResult(b, ctx));

    if (resolvable.length > 0) {
      const synthetic = buildSyntheticModelTurn(resolvable, ctx);
      const last = out[out.length - 1];
      const needsSynthetic =
        synthetic != null &&
        (last == null || !modelTurnCoversToolResults(last, resolvable, ctx));
      if (needsSynthetic) {
        out.push(synthetic);
      }
      out.push({
        role: "user",
        parts: resolvable.map((b) => toolResultToGeminiPart(b, ctx)),
      });
    }

    if (orphaned.length > 0) {
      out.push({
        role: "user",
        parts: orphaned.map((b) => toolResultToGeminiPart(b, ctx)),
      });
    }

    if (other.length > 0) {
      out.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: blocksToGeminiParts(other, ctx),
      });
    }
  }

  return out;
}

/** NM tool definitions → Gemini `tools` array entry. */
export function toolsToGeminiFunctionDeclarations(
  tools: readonly LlmToolDefinition[],
): unknown[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}
