/**
 * Bidirectional mapping between NM content blocks and Gemini generateContent wire format.
 *
 * @module infra/llm-protocol/logic/gemini-content-mapper
 */

import { ProviderError } from "@/errors/provider-errors.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { LlmToolDefinition } from "../ports/adapter.port.js";

type GeminiPart = Record<string, unknown>;
type GeminiContent = { role: string; parts: GeminiPart[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** NM blocks → Gemini `parts` for one content turn. */
export function blocksToGeminiParts(blocks: readonly ContentBlock[]): GeminiPart[] {
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
          },
        });
        break;
      case "tool_result":
        parts.push({
          functionResponse: {
            name: block.toolUseId,
            response: { output: block.content },
          },
        });
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
export function geminiPartsToBlocks(parts: readonly unknown[]): ContentBlock[] {
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
        typeof functionCall.id === "string"
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
      blocks.push({
        type: "tool_result",
        toolUseId: functionResponse.name,
        content,
      });
    }
  }
  return blocks;
}

/** Session history → Gemini `contents[]`. */
export function chatMessagesToGeminiContents(
  messages: readonly ChatMessage[],
): GeminiContent[] {
  const out: GeminiContent[] = [];

  for (const msg of messages) {
    const toolResults = msg.content.blocks.filter((b) => b.type === "tool_result");
    const other = msg.content.blocks.filter((b) => b.type !== "tool_result");

    if (toolResults.length > 0) {
      out.push({
        role: "user",
        parts: blocksToGeminiParts(toolResults),
      });
    }
    if (other.length > 0) {
      out.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: blocksToGeminiParts(other),
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
