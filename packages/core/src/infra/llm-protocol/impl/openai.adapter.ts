/**
 * OpenAI-compatible protocol adapter (Chat Completions: tools, history, system, streaming).
 *
 * Wire serialization lives in {@link ./openai-content-mapper.js}; this module handles HTTP/SSE only.
 *
 * Env: `OPENAI_TOOL_CHOICE_REQUIRED=1` â€?when tools are sent, set `tool_choice` to `"required"`
 * instead of `"auto"` (E2E capture / providers that need forced tool calls).
 *
 * @module infra/llm-protocol/impl/openai.adapter
 */

import { ProviderError } from "@/errors/provider-errors.js";
import { messageBodyTextFromContent } from "@/domain/chat/content/message-body-text.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
  LlmStreamEvent,
  LlmToolDefinition,
} from "../ports/adapter.port.js";
import {
  chatMessagesToOpenAi,
  openAiChoiceToBlocks,
  openAiStreamAccumulatorsToBlocks,
  openAiStreamDeltaToEvents,
} from "../logic/openai-content-mapper.js";
import {
  blocksToTextOnly,
  chatMessagesToTextOnly,
  isTextOnlyHistory,
} from "../logic/text-only-content.js";
import { assertOk, fetchJson, joinUrl } from "../logic/http-util.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    });
    const record = raw as {
      choices?: Array<{ message?: unknown }>;
    };
    const blocks = openAiChoiceToBlocks(record.choices?.[0]?.message ?? {});
    const assistantText = messageBodyTextFromContent({ blocks });
    return { assistantText, blocks, raw };
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
    });
    const record = raw as { choices?: Array<{ message?: unknown }> };
    const blocks = openAiChoiceToBlocks(record.choices?.[0]?.message ?? {});
    const assistantText = messageBodyTextFromContent({ blocks });
    return { assistantText, blocks, raw };
  }

  private async chatStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = joinUrl(req.baseUrl, "/chat/completions");
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
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

    const state = {
      textParts: [] as string[],
      thinkingParts: [] as string[],
      toolCalls: new Map<
        number,
        { id: string; name: string; argumentsJson: string }
      >(),
      emittedToolIndices: new Set<number>(),
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
        const choices = event.choices;
        if (!Array.isArray(choices) || choices.length === 0) {
          continue;
        }
        const first = choices[0];
        if (!isRecord(first)) {
          continue;
        }
        openAiStreamDeltaToEvents(first.delta, state, onStream);
      }
    }

    return openAiStreamAccumulatorsToBlocks(state, onStream);
  }
}
