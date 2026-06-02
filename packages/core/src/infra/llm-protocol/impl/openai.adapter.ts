/**
 * OpenAI-compatible protocol adapter (Chat Completions: tools, history, system, streaming).
 *
 * Wire serialization lives in {@link ./openai-content-mapper.js}; streaming uses
 * {@link postSse} (fetch or RN XHR) plus {@link openai-sse-parser.js}.
 *
 * When `OPENAI_TOOL_CHOICE_REQUIRED=1` and tools are sent, set `tool_choice` to `"required"`
 * instead of `"auto"` (E2E capture / providers that need forced tool calls).
 *
 * @module infra/llm-protocol/impl/openai.adapter
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
  chatMessagesToOpenAi,
  openAiChoiceToBlocks,
  openAiStreamAccumulatorsToPartialBlocks,
} from "../logic/openai-content-mapper.js";
import { isRequestAborted } from "../logic/request-abort.js";
import {
  blocksToTextOnly,
  chatMessagesToTextOnly,
  isTextOnlyHistory,
} from "../logic/text-only-content.js";
import { parseOpenAiUsage } from "../logic/usage-parser.js";
import { fetchJson, joinUrl } from "../logic/http-util.js";
import { postSse } from "../logic/llm-sse-transport.js";
import {
  createOpenAiSseParserState,
  feedOpenAiSseChunk,
  finishOpenAiSse,
} from "../logic/openai-sse-parser.js";

function useTextOnlyShortcut(req: LlmChatRequest): boolean {
  return (
    !req.stream &&
    (req.tools == null || req.tools.length === 0) &&
    (req.system == null || req.system === "") &&
    (req.history == null || isTextOnlyHistory(req.history))
  );
}

function openAiTools(tools: readonly LlmToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export class OpenAiProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "openai" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">,
  ): Promise<LlmListModelsResult> {
    const url = joinUrl(req.baseUrl, "/models");
    const data = (await fetchJson(this.fetchFn, url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        ...req.extraHeaders,
      },
    })) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? [])
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ vendorModelId: m.id! }));
    return { models };
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    if (useTextOnlyShortcut(req)) {
      return this.chatTextOnly(req);
    }
    if (req.stream) {
      return this.chatStream(req);
    }
    return this.chatNonStream(req);
  }

  private buildMessages(req: LlmChatRequest): unknown[] {
    const messages =
      req.history != null && req.history.length > 0
        ? chatMessagesToOpenAi(req.history)
        : [{ role: "user", content: blocksToTextOnly(textBlocks(req.userContent).blocks) }];

    if (req.system != null && req.system !== "") {
      return [{ role: "system", content: req.system }, ...messages];
    }
    return messages;
  }

  private toolChoiceWhenToolsPresent(): "auto" | "required" {
    return process.env.OPENAI_TOOL_CHOICE_REQUIRED === "1" ? "required" : "auto";
  }

  private buildBody(req: LlmChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.vendorModelId,
      messages: this.buildMessages(req),
      stream,
    };
    // OpenAI only emits `usage` on the final stream chunk when include_usage is set.
    if (stream) {
      body.stream_options = { include_usage: true };
    }
    if (req.tools != null && req.tools.length > 0) {
      body.tools = openAiTools(req.tools);
      body.tool_choice = this.toolChoiceWhenToolsPresent();
    }
    if (req.sampling?.protocol === "openai") {
      Object.assign(body, req.sampling.openai);
    }
    return body;
  }

  private async chatTextOnly(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = joinUrl(req.baseUrl, "/chat/completions");
    const userText =
      req.history != null && req.history.length > 0
        ? chatMessagesToTextOnly(req.history)
        : blocksToTextOnly(textBlocks(req.userContent).blocks);

    const raw = await fetchJson(this.fetchFn, url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify({
        model: req.vendorModelId,
        stream: false,
        messages: [{ role: "user", content: userText }],
        ...(req.sampling?.protocol === "openai" ? req.sampling.openai : {}),
      }),
      signal: req.signal,
    });
    const record = raw as {
      choices?: Array<{ message?: unknown }>;
    };
    const blocks = openAiChoiceToBlocks(record.choices?.[0]?.message ?? {});
    const assistantText = messageBodyTextFromContent({ blocks });
    const usage = parseOpenAiUsage(raw);
    return { assistantText, blocks, raw, usage };
  }

  private async chatNonStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = joinUrl(req.baseUrl, "/chat/completions");
    const raw = await fetchJson(this.fetchFn, url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify(this.buildBody(req, false)),
      signal: req.signal,
    });
    const record = raw as { choices?: Array<{ message?: unknown }> };
    const blocks = openAiChoiceToBlocks(record.choices?.[0]?.message ?? {});
    const assistantText = messageBodyTextFromContent({ blocks });
    const usage = parseOpenAiUsage(raw);
    return { assistantText, blocks, raw, usage };
  }

  private async chatStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = joinUrl(req.baseUrl, "/chat/completions");
    const state = createOpenAiSseParserState();

    try {
      await postSse(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${req.apiKey}`,
            "Content-Type": "application/json",
            ...req.extraHeaders,
          },
          body: JSON.stringify(this.buildBody(req, true)),
          signal: req.signal,
        },
        (chunk) => feedOpenAiSseChunk(state, chunk, req.onStream),
        undefined,
        { fetchFn: this.fetchFn, signal: req.signal },
      );
    } catch (error) {
      if (!isRequestAborted(error, req.signal)) {
        throw error;
      }
    }

    const aborted = req.signal?.aborted === true;
    const { blocks, streamRaw } = aborted
      ? {
          blocks: openAiStreamAccumulatorsToPartialBlocks(state, req.onStream),
          streamRaw:
            state.lastUsageEvent ??
            state.lastEvent ??
            ({ streamed: true, aborted: true } as Record<string, unknown>),
        }
      : finishOpenAiSse(state, req.onStream);
    const assistantText = messageBodyTextFromContent({ blocks });
    const usage = parseOpenAiUsage(streamRaw);
    const result: LlmChatResult = {
      assistantText,
      blocks,
      raw: streamRaw ?? { streamed: true },
      usage,
    };
    req.onStream?.({ type: "done", result });
    return result;
  }
}
