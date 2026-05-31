/**
 * Google Gemini protocol adapter (text-only content blocks).
 *
 * @module infra/llm-protocol/impl/gemini.adapter
 */

import { ProviderError } from "@/errors/provider-errors.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
} from "../ports/adapter.port.js";
import { blocksToTextOnly, chatMessagesToTextOnly } from "../logic/text-only-content.js";
import { parseGeminiUsage } from "../logic/usage-parser.js";
import { fetchJson, joinUrl } from "../logic/http-util.js";

export class GeminiProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "gemini" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">,
  ): Promise<LlmListModelsResult> {
    const url = `${joinUrl(req.baseUrl, "/models")}?key=${encodeURIComponent(req.apiKey)}`;
    const data = (await fetchJson(this.fetchFn, url, {
      method: "GET",
      headers: { ...req.extraHeaders },
    })) as { models?: Array<{ name?: string; displayName?: string }> };
    const models = (data.models ?? [])
      .filter((m) => typeof m.name === "string")
      .map((m) => {
        const name = m.name!;
        const vendorModelId = name.includes("/")
          ? name.split("/").pop()!
          : name;
        return {
          vendorModelId,
          displayName:
            typeof m.displayName === "string" ? m.displayName : undefined,
        };
      });
    return { models };
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    if (req.tools != null && req.tools.length > 0) {
      throw new ProviderError(
        "UNSUPPORTED",
        "Gemini protocol adapter does not support tools in this iteration",
      );
    }
    if (req.stream) {
      throw new ProviderError(
        "UNSUPPORTED",
        "Gemini protocol adapter does not support streaming in this iteration",
      );
    }
    const path = `/models/${encodeURIComponent(req.vendorModelId)}:generateContent`;
    const url = `${joinUrl(req.baseUrl, path)}?key=${encodeURIComponent(req.apiKey)}`;
    const userText =
      req.history != null && req.history.length > 0
        ? chatMessagesToTextOnly(req.history)
        : blocksToTextOnly(textBlocks(req.userContent).blocks);

    const raw = await fetchJson(this.fetchFn, url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userText }],
          },
        ],
        ...(req.sampling?.protocol === "gemini"
          ? { generationConfig: { ...req.sampling.gemini } }
          : {}),
      }),
    });
    const record = raw as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = record.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const blocks = [{ type: "text" as const, text }];
    const usage = parseGeminiUsage(raw);
    return { assistantText: text, blocks, raw, usage };
  }
}
