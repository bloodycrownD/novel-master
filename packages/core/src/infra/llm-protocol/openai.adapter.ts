/**
 * OpenAI-compatible protocol adapter (text-only content blocks).
 *
 * @module infra/llm-protocol/openai.adapter
 */

import { ProviderError } from "@/errors/provider-errors.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
} from "./adapter.port.js";
import { blocksToTextOnly, chatMessagesToTextOnly } from "./text-only-content.js";
import { fetchJson, joinUrl } from "./http-util.js";

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
    if (req.tools != null && req.tools.length > 0) {
      throw new ProviderError(
        "UNSUPPORTED",
        "OpenAI protocol adapter does not support tools in this iteration",
      );
    }
    if (req.stream) {
      throw new ProviderError(
        "UNSUPPORTED",
        "OpenAI protocol adapter does not support streaming in this iteration",
      );
    }
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
      }),
    });
    const record = raw as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = record.choices?.[0]?.message?.content ?? "";
    const blocks = [{ type: "text" as const, text }];
    return { assistantText: text, blocks, raw };
  }
}
