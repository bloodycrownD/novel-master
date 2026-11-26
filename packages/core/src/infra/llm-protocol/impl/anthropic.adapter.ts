/**
 * Anthropic protocol adapter (multi-block request/response, tools, streaming).
 *
 * Streaming uses {@link LlmSseTransport.post} so RN gets XHR SSE; abort returns partial blocks.
 *
 * @module infra/llm-protocol/impl/anthropic.adapter
 */

import { MessageBodyText } from "@/domain/chat/content/message-body-text.js";
import { ANTHROPIC_SAMPLING_DEFAULTS } from "@/domain/provider/model/protocol-sampling-defaults.js";
import { TextBlocks } from "@/domain/chat/content/text-blocks.js";
import type { FetchFn, LlmChatRequest, LlmChatResult, LlmListModelsResult, LlmProtocolAdapter, LlmToolDefinition } from "../ports/adapter.port.js";
import { AnthropicMapper } from "../logic/anthropic-content-mapper.js";
import { AnthropicSseParser } from "../logic/anthropic-sse-parser.js";
import { AnthropicToolNames, type AnthropicToolNameWire } from "../logic/anthropic-tool-names.js";
import { ANTHROPIC_API_VERSION } from "../logic/anthropic-api-version.js";
import { HttpUtil } from "../logic/http-util.js";
import { LlmSseTransport } from "../logic/llm-sse-transport.js";
import { RequestAbort } from "../logic/request-abort.js";
import { ThinkingBody } from "../logic/apply-thinking-to-body.js";
import { UsageParser } from "../logic/usage-parser.js";

export const AnthropicAdapter = {
    resolveToolNameWire(req: LlmChatRequest): AnthropicToolNameWire | undefined {
        const names = new Set<string>();
        for (const tool of req.tools ?? []) {
            names.add(tool.name);
        }
        for (const message of req.history ?? []) {
            for (const block of message.content.blocks) {
                if (block.type === "tool_use") {
                    names.add(block.name);
                }
            }
        }
        if (names.size === 0 || !AnthropicToolNames.toolsNeedWireEncoding([...names])) {
            return undefined;
        }
        return AnthropicToolNames.createWire([...names]);
    },
} as const;

export class AnthropicProtocolAdapter implements LlmProtocolAdapter {
    readonly kind = "anthropic" as const;

    constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

    async listModels(req: Omit<LlmChatRequest, "vendorModelId" | "userContent" | "history">): Promise<LlmListModelsResult> {
        const headers = { "x-api-key": req.apiKey, "anthropic-version": ANTHROPIC_API_VERSION, ...req.extraHeaders };
        const fetched = await HttpUtil.fetchJson(this.fetchFn, HttpUtil.joinUrl(req.baseUrl, "/v1/models"), { method: "GET", headers, signal: req.scope?.signal });
        // nm-throw: keep — llm-protocol 协议层边界转码：adapter 契约 @throws，transport catch → reject（error-matrix-final W4 定性）。
        if (!fetched.ok) throw fetched.error;
        const data = fetched.value as { data?: Array<{ id?: string; display_name?: string }> };
        const models = (data.data ?? [])
            .filter((m) => typeof m.id === "string")
            .map((m) => ({
                vendorModelId: m.id!,
                displayName: typeof m.display_name === "string" ? m.display_name : undefined,
            }));
        return { models };
    }

    async chat(req: LlmChatRequest): Promise<LlmChatResult> {
        if (req.stream) {
            const toolNames = AnthropicAdapter.resolveToolNameWire(req);
            const url = HttpUtil.joinUrl(req.baseUrl, "/v1/messages");
            const parser = AnthropicSseParser.create({ onStream: req.onStream, toolNames });

            try {
                const headers = { "x-api-key": req.apiKey, "anthropic-version": ANTHROPIC_API_VERSION, "Content-Type": "application/json", ...req.extraHeaders };
                const init = { method: "POST", headers, body: JSON.stringify(this.buildBody(req, true, toolNames)), signal: req.scope?.signal };
                await LlmSseTransport.post({ url, init, onChunk: (chunk) => parser.feed(chunk), fetchFn: this.fetchFn, signal: req.scope?.signal });
            } catch (error) {
                if (!RequestAbort.isAborted(error, req.scope?.signal)) {
                    // nm-throw: keep — adapter 层契约：chat 以 reject 报错（Promise<LlmChatResult> 无失败分支），由 model-request.service 的 catch 收口成 Result。
                    throw error;
                }
            }

            const aborted = req.scope?.signal.aborted === true;
            const finishResult = aborted ? parser.finishPartial() : parser.finish();
            const { blocks, streamRaw, degradedToolCalls = [] } = finishResult;
            const assistantText = MessageBodyText.fromBlocks(blocks);
            const usage = UsageParser.parse("anthropic", streamRaw);
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

        const toolNames = AnthropicAdapter.resolveToolNameWire(req);
        const url = HttpUtil.joinUrl(req.baseUrl, "/v1/messages");
        const headers = { "x-api-key": req.apiKey, "anthropic-version": ANTHROPIC_API_VERSION, "Content-Type": "application/json", ...req.extraHeaders };
        const fetched = await HttpUtil.fetchJson(this.fetchFn, url, { method: "POST", headers, body: JSON.stringify(this.buildBody(req, false, toolNames)), signal: req.scope?.signal });
        // nm-throw: keep — llm-protocol 协议层边界转码：adapter 契约 @throws，transport catch → reject（error-matrix-final W4 定性）。
        if (!fetched.ok) throw fetched.error;
        const raw = fetched.value;
        const record = raw as { content?: unknown[] };
        const blocks = AnthropicMapper.contentToBlocks(record.content ?? [], toolNames);
        const assistantText = MessageBodyText.fromBlocks(blocks);
        const usage = UsageParser.parse("anthropic", raw);
        return { assistantText, blocks, raw, usage };
    }

    private buildBody(req: LlmChatRequest, stream: boolean, toolNames?: AnthropicToolNameWire): Record<string, unknown> {
        let messages: unknown[];
        if (req.history != null && req.history.length > 0) {
            messages = AnthropicMapper.chatMessagesTo(req.history, toolNames);
        } else {
            messages = [{ role: "user", content: AnthropicMapper.blocksToContent(TextBlocks.of(req.userContent).blocks, toolNames) }];
        }
        const body: Record<string, unknown> = {
            model: req.vendorModelId,
            // 与 UI 采样默认值同源（`ANTHROPIC_SAMPLING_DEFAULTS.max_tokens`）。
            // 旧形态硬写 4096，而 thinking budget 又按 `effectiveMax - 1` 钳制 ⇒
            // 默认配置下 thinking 占 4095、可见正文只剩 1 token，三档 thinkingLevel 无差别。
            // 刻意**不经** `resolve-thinking-wire.ts` 中转：它与 `thinking-level-presets.ts`
            // 已构成一对既存循环依赖，为一个数字把整对循环拖进 adapter 启动链不划算。
            max_tokens: ANTHROPIC_SAMPLING_DEFAULTS.max_tokens,
            messages,
            stream,
        };
        if (req.system != null && req.system !== "") {
            body.system = req.system;
        }
        if (req.tools != null && req.tools.length > 0) {
            body.tools = req.tools.map((t: LlmToolDefinition) => ({ name: toolNames?.toWire(t.name) ?? t.name, description: t.description, input_schema: t.inputSchema }));
        }
        if (req.sampling?.protocol === "anthropic") {
            const s = req.sampling.anthropic;
            if (s.temperature != null) body.temperature = s.temperature;
            if (s.top_p != null) body.top_p = s.top_p;
            if (s.top_k != null) body.top_k = s.top_k;
            if (s.max_tokens != null) body.max_tokens = s.max_tokens;
        }
        ThinkingBody.apply("anthropic", body, req.thinking);
        // 自定义参数最后合并：用户显式配置覆盖一切同名 wire 字段（含 sampling / thinking）。
        Object.assign(body, req.extraBody);
        return body;
    }
}
