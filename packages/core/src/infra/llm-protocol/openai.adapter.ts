/**
 * OpenAI-compatible protocol adapter.
 *
 * @module infra/llm-protocol/openai.adapter
 */

import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
} from "./adapter.port.js";
import { fetchJson, joinUrl } from "./http-util.js";

export class OpenAiProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "openai" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent">,
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
    const url = joinUrl(req.baseUrl, "/chat/completions");
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
        messages: [{ role: "user", content: req.userContent }],
      }),
    });
    const record = raw as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = record.choices?.[0]?.message?.content ?? "";
    return { assistantText: text, raw };
  }
}
