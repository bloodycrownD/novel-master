/**
 * Anthropic protocol adapter (multi-block request/response, tools, streaming).
 *
 * Streaming uses {@link postSse} so RN gets XHR SSE; abort returns partial blocks.
 *
 * @module infra/llm-protocol/impl/anthropic.adapter
 */

import { messageBodyTextFromContent } from "@/domain/chat/content/message-body-text.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
  LlmToolDefinition,
} from "../ports/adapter.port.js";
import {
  anthropicContentToBlocks,
  blocksToAnthropicContent,
  chatMessagesToAnthropic,
} from "../logic/anthropic-content-mapper.js";
import {
  createAnthropicSseParserState,
  feedAnthropicSseChunk,
  finishAnthropicSse,
  finishAnthropicSsePartial,
} from "../logic/anthropic-sse-parser.js";
import {
  anthropicToolsNeedWireEncoding,
  createAnthropicToolNameWire,
  type AnthropicToolNameWire,
} from "../logic/anthropic-tool-names.js";
import { ANTHROPIC_API_VERSION } from "../logic/anthropic-api-version.js";
import { fetchJson, joinUrl } from "../logic/http-util.js";
import { postSse } from "../logic/llm-sse-transport.js";
import { isRequestAborted } from "../logic/request-abort.js";
import { applyAnthropicThinkingToBody } from "../logic/apply-thinking-to-body.js";
import { parseAnthropicUsage } from "../logic/usage-parser.js";

function anthropicTools(
  tools: readonly LlmToolDefinition[],
  toolNames?: AnthropicToolNameWire,
): unknown[] {
  return tools.map((t) => ({
    name: toolNames?.toWire(t.name) ?? t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

function resolveAnthropicToolNameWire(
  req: LlmChatRequest,
): AnthropicToolNameWire | undefined {
  const names = new Set<string>();
  for (const tool of req.tools ?? []) {
    names.add(tool.name);
  }
  for (const message of req.history ?? []) {
    for (const block of message.content.blocks) {
      if (block.type === "tool_use") {
        names.add(block.name);
      }
    }
  }
  if (names.size === 0 || !anthropicToolsNeedWireEncoding([...names])) {
    return undefined;
  }
  return createAnthropicToolNameWire([...names]);
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
        "anthropic-version": ANTHROPIC_API_VERSION,
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

  private buildMessages(req: LlmChatRequest, toolNames?: AnthropicToolNameWire) {
    return req.history != null && req.history.length > 0
      ? chatMessagesToAnthropic(req.history, toolNames)
      : [
          {
            role: "user",
            content: blocksToAnthropicContent(
              textBlocks(req.userContent).blocks,
              toolNames,
            ),
          },
        ];
  }

  private buildBody(
    req: LlmChatRequest,
    stream: boolean,
    toolNames?: AnthropicToolNameWire,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.vendorModelId,
      max_tokens: 4096,
      messages: this.buildMessages(req, toolNames),
      stream,
    };
    if (req.system != null && req.system !== "") {
      body.system = req.system;
    }
    if (req.tools != null && req.tools.length > 0) {
      body.tools = anthropicTools(req.tools, toolNames);
    }
    if (req.sampling?.protocol === "anthropic") {
      const s = req.sampling.anthropic;
      if (s.temperature != null) body.temperature = s.temperature;
      if (s.top_p != null) body.top_p = s.top_p;
      if (s.top_k != null) body.top_k = s.top_k;
      if (s.max_tokens != null) body.max_tokens = s.max_tokens;
    }
    applyAnthropicThinkingToBody(body, req.thinking);
    return body;
  }

  private async chatNonStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const toolNames = resolveAnthropicToolNameWire(req);
    const url = joinUrl(req.baseUrl, "/v1/messages");
    const raw = await fetchJson(this.fetchFn, url, {
      method: "POST",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify(this.buildBody(req, false, toolNames)),
      signal: req.signal,
    });
    const record = raw as { content?: unknown[] };
    const blocks = anthropicContentToBlocks(record.content ?? [], toolNames);
    const assistantText = messageBodyTextFromContent({ blocks });
    const usage = parseAnthropicUsage(raw);
    return { assistantText, blocks, raw, usage };
  }

  private async chatStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const toolNames = resolveAnthropicToolNameWire(req);
    const url = joinUrl(req.baseUrl, "/v1/messages");
    const state = createAnthropicSseParserState();

    try {
      await postSse(
        url,
        {
          method: "POST",
          headers: {
            "x-api-key": req.apiKey,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "Content-Type": "application/json",
            ...req.extraHeaders,
          },
          body: JSON.stringify(this.buildBody(req, true, toolNames)),
          signal: req.signal,
        },
        (chunk) => feedAnthropicSseChunk(state, chunk, req.onStream),
        undefined,
        { fetchFn: this.fetchFn, signal: req.signal },
      );
    } catch (error) {
      if (!isRequestAborted(error, req.signal)) {
        throw error;
      }
    }

    const aborted = req.signal?.aborted === true;
    const finishResult = aborted
      ? finishAnthropicSsePartial(state, req.onStream, toolNames)
      : finishAnthropicSse(state, req.onStream, toolNames);
    const { blocks, streamRaw, degradedToolCalls = [] } = finishResult;
    const assistantText = messageBodyTextFromContent({ blocks });
    const usage = parseAnthropicUsage(streamRaw);
    const result: LlmChatResult = {
      assistantText,
      blocks,
      raw: streamRaw ?? { streamed: true },
      usage,
      ...(degradedToolCalls.length > 0 ? { degradedToolCalls } : {}),
    };
    req.onStream?.({ type: "done", result });
    return result;
  }
}
