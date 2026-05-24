/**
 * Google Gemini protocol adapter.
 *
 * @module infra/llm-protocol/gemini.adapter
 */

import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
} from "./adapter.port.js";
import { fetchJson, joinUrl } from "./http-util.js";

export class GeminiProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "gemini" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(
    req: Omit<LlmChatRequest, "vendorModelId" | "userContent">,
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
    const path = `/models/${encodeURIComponent(req.vendorModelId)}:generateContent`;
    const url = `${joinUrl(req.baseUrl, path)}?key=${encodeURIComponent(req.apiKey)}`;
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
            parts: [{ text: req.userContent }],
          },
        ],
      }),
    });
    const record = raw as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = record.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return { assistantText: text, raw };
  }
}
