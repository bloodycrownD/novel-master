/**
 * Anthropic protocol adapter (multi-block request/response, tools, streaming).
 *
 * @module infra/llm-protocol/anthropic.adapter
 */

import { messageBodyTextFromContent } from "@/domain/chat/content/message-body-text.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import { ProviderError } from "@/errors/provider-errors.js";
import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
  LlmStreamEvent,
  LlmToolDefinition,
} from "./adapter.port.js";
import {
  anthropicContentToBlocks,
  blocksToAnthropicContent,
  chatMessagesToAnthropic,
} from "./anthropic-content-mapper.js";
import { assertOk, fetchJson, joinUrl } from "./http-util.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function anthropicTools(tools: readonly LlmToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

export class AnthropicProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "anthropic" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">,
  ): Promise<LlmListModelsResult> {
    const data = (await fetchJson(this.fetchFn, joinUrl(req.baseUrl, "/v1/models"), {
      method: "GET",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
        ...req.extraHeaders,
      },
    })) as { data?: Array<{ id?: string; display_name?: string }> };
    const models = (data.data ?? [])
      .filter((m) => typeof m.id === "string")
      .map((m) => ({
        vendorModelId: m.id!,
        displayName:
          typeof m.display_name === "string" ? m.display_name : undefined,
      }));
    return { models };
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    if (req.stream) {
      return this.chatStream(req);
    }
    return this.chatNonStream(req);
  }

  private buildMessages(req: LlmChatRequest) {
    return req.history != null && req.history.length > 0
      ? chatMessagesToAnthropic(req.history)
      : [
          {
            role: "user",
            content: blocksToAnthropicContent(textBlocks(req.userContent).blocks),
          },
        ];
  }

  private buildBody(req: LlmChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.vendorModelId,
      max_tokens: 4096,
      messages: this.buildMessages(req),
      stream,
    };
    if (req.system != null && req.system !== "") {
      body.system = req.system;
    }
    if (req.tools != null && req.tools.length > 0) {
      body.tools = anthropicTools(req.tools);
    }
    if (req.sampling?.protocol === "anthropic") {
      const s = req.sampling.anthropic;
      if (s.temperature != null) body.temperature = s.temperature;
      if (s.top_p != null) body.top_p = s.top_p;
      if (s.top_k != null) body.top_k = s.top_k;
      if (s.max_tokens != null) body.max_tokens = s.max_tokens;
    }
    return body;
  }

  private async chatNonStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = joinUrl(req.baseUrl, "/v1/messages");
    const raw = await fetchJson(this.fetchFn, url, {
      method: "POST",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify(this.buildBody(req, false)),
    });
    const record = raw as { content?: unknown[] };
    const blocks = anthropicContentToBlocks(record.content ?? []);
    const assistantText = messageBodyTextFromContent({ blocks });
    return { assistantText, blocks, raw };
  }

  private async chatStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = joinUrl(req.baseUrl, "/v1/messages");
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify(this.buildBody(req, true)),
    });
    await assertOk(response);
    if (response.body == null) {
      throw new ProviderError("HTTP_ERROR", "Empty streaming response body");
    }

    const blocks = await this.parseSseStream(response.body, req.onStream);
    const assistantText = messageBodyTextFromContent({ blocks });
    const result: LlmChatResult = { assistantText, blocks, raw: { streamed: true } };
    req.onStream?.({ type: "done", result });
    return result;
  }

  private async parseSseStream(
    body: ReadableStream<Uint8Array>,
    onStream?: (event: LlmStreamEvent) => void,
  ): Promise<ContentBlock[]> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const textParts: string[] = [];
    const thinkingParts: string[] = [];
    const toolUses: Array<{
      id: string;
      name: string;
      inputJson: string;
    }> = [];
    let currentToolIndex = -1;

    const flushBlock = () => {
      currentToolIndex = -1;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }
        const payload = line.slice(6).trim();
        if (payload === "" || payload === "[DONE]") {
          continue;
        }
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = event.type;
        if (type === "content_block_start") {
          const block = event.content_block;
          if (isRecord(block) && block.type === "tool_use") {
            toolUses.push({
              id: typeof block.id === "string" ? block.id : "",
              name: typeof block.name === "string" ? block.name : "",
              inputJson: "",
            });
            currentToolIndex = toolUses.length - 1;
          }
        } else if (type === "content_block_delta") {
          const delta = event.delta;
          if (!isRecord(delta)) {
            continue;
          }
          if (delta.type === "text_delta" && typeof delta.text === "string") {
            textParts.push(delta.text);
            onStream?.({ type: "text-delta", text: delta.text });
          } else if (
            delta.type === "thinking_delta" &&
            typeof delta.thinking === "string"
          ) {
            thinkingParts.push(delta.thinking);
            onStream?.({ type: "thinking-delta", text: delta.thinking });
          } else if (
            delta.type === "input_json_delta" &&
            typeof delta.partial_json === "string" &&
            currentToolIndex >= 0
          ) {
            toolUses[currentToolIndex]!.inputJson += delta.partial_json;
          }
        } else if (type === "content_block_stop") {
          flushBlock();
        }
      }
    }

    const blocks: ContentBlock[] = [];
    const text = textParts.join("");
    if (text !== "") {
      blocks.push({ type: "text", text });
    }
    const thinking = thinkingParts.join("");
    if (thinking !== "") {
      blocks.push({ type: "thinking", text: thinking });
    }
    for (const tu of toolUses) {
      let input: Record<string, unknown> = {};
      try {
        input = tu.inputJson ? (JSON.parse(tu.inputJson) as Record<string, unknown>) : {};
      } catch {
        input = {};
      }
      blocks.push({
        type: "tool_use",
        id: tu.id,
        name: tu.name,
        input,
      });
      onStream?.({
        type: "tool-use",
        id: tu.id,
        name: tu.name,
        input,
      });
    }
    return blocks;
  }
}
