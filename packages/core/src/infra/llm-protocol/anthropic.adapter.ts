/**
 * Anthropic protocol adapter.
 *
 * @module infra/llm-protocol/anthropic.adapter
 */

import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
} from "./adapter.port.js";
import { fetchJson, joinUrl } from "./http-util.js";

export class AnthropicProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "anthropic" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent">,
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
        messages: [{ role: "user", content: req.userContent }],
      }),
    });
    const record = raw as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = record.content?.[0]?.text ?? "";
    return { assistantText: text, raw };
  }
}
