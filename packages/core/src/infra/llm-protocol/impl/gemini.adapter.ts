/**
 * Google Gemini protocol adapter (structured contents, tools, streaming via postSse).
 *
 * @module infra/llm-protocol/impl/gemini.adapter
 */

import { MessageBodyText } from "@/domain/chat/content/message-body-text.js";
import { TextBlocks } from "@/domain/chat/content/text-blocks.js";
import type { FetchFn, LlmChatRequest, LlmChatResult, LlmListModelsResult, LlmProtocolAdapter } from "../ports/adapter.port.js";
import { blocksToGeminiParts, chatMessagesToGeminiContents, geminiPartsToBlocks, toolsToGeminiFunctionDeclarations } from "../logic/gemini-content-mapper.js";
import { createGeminiSseParser } from "../logic/gemini-sse-parser.js";
import { fetchJson, joinUrl } from "../logic/http-util.js";
import { postSse } from "../logic/llm-sse-transport.js";
import { isRequestAborted } from "../logic/request-abort.js";
import { applyThinkingToBody } from "../logic/apply-thinking-to-body.js";
import { parseUsage } from "../logic/usage-parser.js";

export class GeminiProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "gemini" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">): Promise<LlmListModelsResult> {
    const url = `${joinUrl(req.baseUrl, "/models")}?key=${encodeURIComponent(req.apiKey)}`;
    const fetched = await fetchJson(this.fetchFn, url, { method: "GET", headers: { ...req.extraHeaders }, signal: req.scope?.signal });
    if (!fetched.ok) throw fetched.error;
    const data = fetched.value as { models?: Array<{ name?: string; displayName?: string }> };
    const models = (data.models ?? [])
      .filter((m) => typeof m.name === "string")
      .map((m) => {
        const name = m.name!;
        const vendorModelId = name.includes("/") ? name.split("/").pop()! : name;
        return {
          vendorModelId,
          displayName: typeof m.displayName === "string" ? m.displayName : undefined,
        };
      });
    return { models };
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    if (req.stream) {
      const url = this.modelUrl(req, "streamGenerateContent");
      const parser = createGeminiSseParser({ onStream: req.onStream });

      try {
        const headers = { "Content-Type": "application/json", ...req.extraHeaders };
        const init = { method: "POST", headers, body: JSON.stringify(this.buildRequestBody(req)), signal: req.scope?.signal };
        await postSse(url, init, (chunk) => parser.feed(chunk), undefined, { fetchFn: this.fetchFn, signal: req.scope?.signal });
      } catch (error) {
        if (!isRequestAborted(error, req.scope?.signal)) {
          throw error;
        }
      }

      const aborted = req.scope?.signal.aborted === true;
      const finishResult = aborted ? parser.finishPartial() : parser.finish();
      const { blocks, streamRaw, degradedToolCalls = [] } = finishResult;
      const assistantText = MessageBodyText.fromBlocks(blocks);
      const usage = parseUsage("gemini", streamRaw);
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

    const url = this.modelUrl(req, "generateContent");
    const headers = { "Content-Type": "application/json", ...req.extraHeaders };
    const fetched = await fetchJson(this.fetchFn, url, { method: "POST", headers, body: JSON.stringify(this.buildRequestBody(req)), signal: req.scope?.signal });
    if (!fetched.ok) throw fetched.error;
    const raw = fetched.value;
    const record = raw as { candidates?: Array<{ content?: { parts?: unknown[] } }> };
    const parts = record.candidates?.[0]?.content?.parts ?? [];
    const blocks = geminiPartsToBlocks(parts);
    const assistantText = MessageBodyText.fromBlocks(blocks);
    const usage = parseUsage("gemini", raw);
    return { assistantText, blocks, raw, usage };
  }

  private buildRequestBody(req: LlmChatRequest): Record<string, unknown> {
    let contents: unknown[];
    if (req.history != null && req.history.length > 0) {
      const mapped = chatMessagesToGeminiContents(req.history, { toolLookupMessages: req.toolUseLookupMessages, knownToolNames: req.tools?.map((t) => t.name) });
      if (!mapped.ok) throw mapped.error;
      contents = mapped.value;
    } else {
      const parts = blocksToGeminiParts(TextBlocks.of(req.userContent).blocks);
      if (!parts.ok) throw parts.error;
      contents = [{ role: "user", parts: parts.value }];
    }
    const body: Record<string, unknown> = { contents };
    if (req.system != null && req.system !== "") {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }
    if (req.tools != null && req.tools.length > 0) {
      body.tools = toolsToGeminiFunctionDeclarations(req.tools);
    }
    if (req.sampling?.protocol === "gemini") {
      body.generationConfig = { ...req.sampling.gemini };
    }
    applyThinkingToBody("gemini", body, req.thinking);
    // 自定义参数最后合并：用户显式配置覆盖一切同名 wire 字段（含 generationConfig）。
    Object.assign(body, req.extraBody);
    return body;
  }

  private modelUrl(req: LlmChatRequest, action: "generateContent" | "streamGenerateContent"): string {
    const path = `/models/${encodeURIComponent(req.vendorModelId)}:${action}`;
    const base = `${joinUrl(req.baseUrl, path)}?key=${encodeURIComponent(req.apiKey)}`;
    return action === "streamGenerateContent" ? `${base}&alt=sse` : base;
  }
}
