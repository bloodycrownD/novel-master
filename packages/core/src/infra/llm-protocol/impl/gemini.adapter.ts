/**
 * Google Gemini protocol adapter (structured contents, tools, streaming via postSse).
 *
 * @module infra/llm-protocol/impl/gemini.adapter
 */

import { messageBodyTextFromContent } from "@/domain/chat/content/message-body-text.js";
import { textBlocks } from "@/domain/chat/content/text-blocks.js";
import type {
  FetchFn,
  LlmChatRequest,
  LlmChatResult,
  LlmListModelsResult,
  LlmProtocolAdapter,
} from "../ports/adapter.port.js";
import {
  blocksToGeminiParts,
  chatMessagesToGeminiContents,
  geminiPartsToBlocks,
  toolsToGeminiFunctionDeclarations,
} from "../logic/gemini-content-mapper.js";
import {
  createGeminiSseParserState,
  feedGeminiSseChunk,
  finishGeminiSse,
  finishGeminiSsePartial,
} from "../logic/gemini-sse-parser.js";
import { fetchJson, joinUrl } from "../logic/http-util.js";
import { postSse } from "../logic/llm-sse-transport.js";
import { isRequestAborted } from "../logic/request-abort.js";
import { applyGeminiThinkingToBody } from "../logic/apply-thinking-to-body.js";
import { parseGeminiUsage } from "../logic/usage-parser.js";

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
    if (req.stream) {
      return this.chatStream(req);
    }
    return this.chatNonStream(req);
  }

  private buildContents(req: LlmChatRequest) {
    return req.history != null && req.history.length > 0
      ? chatMessagesToGeminiContents(req.history, {
          toolLookupMessages: req.toolUseLookupMessages,
          knownToolNames: req.tools?.map((t) => t.name),
        })
      : [
          {
            role: "user",
            parts: blocksToGeminiParts(textBlocks(req.userContent).blocks),
          },
        ];
  }

  private buildRequestBody(req: LlmChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: this.buildContents(req),
    };
    if (req.system != null && req.system !== "") {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }
    if (req.tools != null && req.tools.length > 0) {
      body.tools = toolsToGeminiFunctionDeclarations(req.tools);
    }
    if (req.sampling?.protocol === "gemini") {
      body.generationConfig = { ...req.sampling.gemini };
    }
    applyGeminiThinkingToBody(body, req.thinking);
    return body;
  }

  private modelUrl(req: LlmChatRequest, action: "generateContent" | "streamGenerateContent"): string {
    const path = `/models/${encodeURIComponent(req.vendorModelId)}:${action}`;
    const base = `${joinUrl(req.baseUrl, path)}?key=${encodeURIComponent(req.apiKey)}`;
    return action === "streamGenerateContent" ? `${base}&alt=sse` : base;
  }

  private async chatNonStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = this.modelUrl(req, "generateContent");
    const raw = await fetchJson(this.fetchFn, url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...req.extraHeaders,
      },
      body: JSON.stringify(this.buildRequestBody(req)),
      signal: req.signal,
    });
    const record = raw as {
      candidates?: Array<{
        content?: { parts?: unknown[] };
      }>;
    };
    const parts = record.candidates?.[0]?.content?.parts ?? [];
    const blocks = geminiPartsToBlocks(parts);
    const assistantText = messageBodyTextFromContent({ blocks });
    const usage = parseGeminiUsage(raw);
    return { assistantText, blocks, raw, usage };
  }

  private async chatStream(req: LlmChatRequest): Promise<LlmChatResult> {
    const url = this.modelUrl(req, "streamGenerateContent");
    const state = createGeminiSseParserState();

    try {
      await postSse(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...req.extraHeaders,
          },
          body: JSON.stringify(this.buildRequestBody(req)),
          signal: req.signal,
        },
        (chunk) => feedGeminiSseChunk(state, chunk, req.onStream),
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
      ? finishGeminiSsePartial(state, req.onStream)
      : finishGeminiSse(state, req.onStream);
    const assistantText = messageBodyTextFromContent({ blocks });
    const usage = parseGeminiUsage(streamRaw);
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
