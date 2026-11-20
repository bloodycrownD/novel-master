/**
 * OpenAI-compatible protocol adapter (Chat Completions: tools, history, system, streaming).
 *
 * Wire serialization lives in {@link ./openai-content-mapper.js}; streaming uses
 * {@link LlmSseTransport.post} (fetch or RN XHR) plus {@link ./openai-sse-parser.js}.
 *
 * When `OPENAI_TOOL_CHOICE_REQUIRED=1` and tools are sent, set `tool_choice` to `"required"`
 * instead of `"auto"` (E2E capture / providers that need forced tool calls).
 *
 * @module infra/llm-protocol/impl/openai.adapter
 */

import { MessageBodyText } from "@/domain/chat/content/message-body-text.js";
import { TextBlocks } from "@/domain/chat/content/text-blocks.js";
import type { FetchFn, LlmChatRequest, LlmChatResult, LlmListModelsResult, LlmProtocolAdapter } from "../ports/adapter.port.js";
import { OpenAiMapper } from "../logic/openai-content-mapper.js";
import { RequestAbort } from "../logic/request-abort.js";
import { TextOnlyContent } from "../logic/text-only-content.js";
import { UsageParser } from "../logic/usage-parser.js";
import { HttpUtil } from "../logic/http-util.js";
import { LlmSseTransport } from "../logic/llm-sse-transport.js";
import { OpenAiSseParser } from "../logic/openai-sse-parser.js";
import { ThinkingBody } from "../logic/apply-thinking-to-body.js";

export class OpenAiProtocolAdapter implements LlmProtocolAdapter {
  readonly kind = "openai" as const;

  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  async listModels(req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">): Promise<LlmListModelsResult> {
    const url = HttpUtil.joinUrl(req.baseUrl, "/models");
    const fetched = await HttpUtil.fetchJson(this.fetchFn, url, { method: "GET", headers: { Authorization: `Bearer ${req.apiKey}`, ...req.extraHeaders }, signal: req.scope?.signal });
    if (!fetched.ok) throw fetched.error;
    const data = fetched.value as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).filter((m) => typeof m.id === "string").map((m) => ({ vendorModelId: m.id! }));
    return { models };
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResult> {
    if (req.thinking == null && !req.stream && (req.tools == null || req.tools.length === 0) && (req.system == null || req.system === "") && (req.history == null || TextOnlyContent.isTextOnlyHistory(req.history))) {
      const url = HttpUtil.joinUrl(req.baseUrl, "/chat/completions");
      const userText = req.history != null && req.history.length > 0 ? TextOnlyContent.chatMessagesToTextOnly(req.history) : TextOnlyContent.blocksToTextOnly(TextBlocks.of(req.userContent).blocks);
      if (!userText.ok) throw userText.error;

      const body: Record<string, unknown> = {
        model: req.vendorModelId,
        stream: false,
        messages: [{ role: "user", content: userText.value }],
        ...(req.sampling?.protocol === "openai" ? req.sampling.openai : {}),
      };
      ThinkingBody.apply("openai", body, req.thinking);
      // 与 buildBody 一致：自定义参数最后合并，覆盖同名标准字段。
      Object.assign(body, req.extraBody);

      const headers = { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json", ...req.extraHeaders };
      const fetched = await HttpUtil.fetchJson(this.fetchFn, url, { method: "POST", headers, body: JSON.stringify(body), signal: req.scope?.signal });
      if (!fetched.ok) throw fetched.error;
      const raw = fetched.value;
      const record = raw as { choices?: Array<{ message?: unknown }> };
      const blocks = OpenAiMapper.choiceToBlocks(record.choices?.[0]?.message ?? {});
      const assistantText = MessageBodyText.fromBlocks(blocks);
      const usage = UsageParser.parse("openai", raw);
      return { assistantText, blocks, raw, usage };
    }

    if (req.stream) {
      const url = HttpUtil.joinUrl(req.baseUrl, "/chat/completions");
      const parser = OpenAiSseParser.create({ onStream: req.onStream });

      try {
        const headers = { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json", ...req.extraHeaders };
        const init = { method: "POST", headers, body: JSON.stringify(this.buildBody(req, true)), signal: req.scope?.signal };
        await LlmSseTransport.post(url, init, (chunk) => parser.feed(chunk), undefined, { fetchFn: this.fetchFn, signal: req.scope?.signal });
      } catch (error) {
        if (!RequestAbort.isAborted(error, req.scope?.signal)) {
          throw error;
        }
      }

      const aborted = req.scope?.signal.aborted === true;
      // 保持既有顺序：正常收尾也先构造一次 partial——它先 emit 流中已完整的
      // tool-use 并标记 emittedToolIndices，finish 只补剩余项，事件次序不变。
      const partialResult = parser.finishPartial();
      const finishResult = aborted ? partialResult : parser.finish();
      const { blocks, streamRaw, degradedToolCalls } = finishResult;
      const assistantText = MessageBodyText.fromBlocks(blocks);
      const usage = UsageParser.parse("openai", streamRaw);
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

    const url = HttpUtil.joinUrl(req.baseUrl, "/chat/completions");
    const headers = { Authorization: `Bearer ${req.apiKey}`, "Content-Type": "application/json", ...req.extraHeaders };
    const fetched = await HttpUtil.fetchJson(this.fetchFn, url, { method: "POST", headers, body: JSON.stringify(this.buildBody(req, false)), signal: req.scope?.signal });
    if (!fetched.ok) throw fetched.error;
    const raw = fetched.value;
    const record = raw as { choices?: Array<{ message?: unknown }> };
    const blocks = OpenAiMapper.choiceToBlocks(record.choices?.[0]?.message ?? {});
    const assistantText = MessageBodyText.fromBlocks(blocks);
    const usage = UsageParser.parse("openai", raw);
    return { assistantText, blocks, raw, usage };
  }

  private withSystemMessage(req: LlmChatRequest, messages: unknown[]): unknown[] {
    if (req.system != null && req.system !== "") {
      return [{ role: "system", content: req.system }, ...messages];
    }
    return messages;
  }

  private buildBody(req: LlmChatRequest, stream: boolean): Record<string, unknown> {
    let messages: unknown[];
    if (req.history != null && req.history.length > 0) {
      const mapped = OpenAiMapper.chatMessagesTo(req.history);
      if (!mapped.ok) throw mapped.error;
      messages = this.withSystemMessage(req, mapped.value);
    } else {
      const content = TextOnlyContent.blocksToTextOnly(TextBlocks.of(req.userContent).blocks);
      if (!content.ok) throw content.error;
      messages = this.withSystemMessage(req, [{ role: "user", content: content.value }]);
    }
    const body: Record<string, unknown> = {
      model: req.vendorModelId,
      messages,
      stream,
    };
    // OpenAI only emits `usage` on the final stream chunk when include_usage is set.
    if (stream) {
      body.stream_options = { include_usage: true };
    }
    if (req.tools != null && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      body.tool_choice = process.env.OPENAI_TOOL_CHOICE_REQUIRED === "1" ? "required" : "auto";
    }
    if (req.sampling?.protocol === "openai") {
      Object.assign(body, req.sampling.openai);
    }
    ThinkingBody.apply("openai", body, req.thinking);
    // 自定义参数最后合并：用户显式配置覆盖一切同名 wire 字段（含 sampling / thinking）。
    Object.assign(body, req.extraBody);
    return body;
  }
}
