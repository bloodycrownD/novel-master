/**
 * Anthropic protocol adapter (multi-block request/response).
 *
 * @module infra/llm-protocol/anthropic.adapter
 */

import { messageBodyTextFromContent } from "@/domain/chat/content/message-body-text.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
} from "./adapter.port.js";
import {
  anthropicContentToBlocks,
  blocksToAnthropicContent,
  chatMessagesToAnthropic,
} from "./anthropic-content-mapper.js";
import { fetchJson, joinUrl } from "./http-util.js";

export class AnthropicProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "anthropic" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">,
  ): Promise<LlmListModelsResult> {
    const url = joinUrl(req.baseUrl, "/v1/models");
    const data = (await fetchJson(this.fetchFn, url, {
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
    const url = joinUrl(req.baseUrl, "/v1/messages");
    const messages =
      req.history != null && req.history.length > 0
        ? chatMessagesToAnthropic(req.history)
        : [
            {
              role: "user",
              content: blocksToAnthropicContent(textBlocks(req.userContent).blocks),
            },
          ];

    const raw = await fetchJson(this.fetchFn, url, {
      method: "POST",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify({
        model: req.vendorModelId,
        max_tokens: 1024,
        messages,
      }),
    });
    const record = raw as { content?: unknown[] };
    const blocks = anthropicContentToBlocks(record.content ?? []);
    const assistantText = messageBodyTextFromContent({ blocks });
    return { assistantText, blocks, raw };
  }
}
