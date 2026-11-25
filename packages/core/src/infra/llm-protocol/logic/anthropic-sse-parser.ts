/**
 * Incremental Anthropic Messages API SSE parser.
 *
 * Shared by {@link LlmSseTransport.post} chunk delivery; abort partial uses {@link StreamPartialBlocks.build}.
 * State 收在 {@link AnthropicSseParser.create} 闭包里，同名动词归位到对象方法。
 *
 * @module infra/llm-protocol/logic/anthropic-sse-parser
 */

import { Guards } from "@/common/guards.js";
import type { ContentBlock } from "@/domain/chat/model/content-block.js";
import type { DegradedToolCall, LlmStreamEvent } from "../ports/adapter.port.js";
import type { AnthropicToolNameWire } from "./anthropic-tool-names.js";
import { StreamPartialBlocks } from "./stream-partial-blocks.js";
import { SseJsonEvents } from "./sse-json-events.js";
import { SseLineBuffer } from "./sse-line-buffer.js";
import { SseParseErrors, type SseFinishResult, type SseParseDiagnostics } from "./sse-parse-errors.js";
import { ToolArguments } from "./tool-arguments-parse.js";
import { ANTHROPIC_USAGE_FIELDS, UsageParser } from "./usage-parser.js";

type ToolUseAccumulator = {
    id: string;
    name: string;
    inputJson: string;
};

type ActiveBlock =
    | { type: "text"; parts: string[] }
    | { type: "thinking"; text: string[]; signature: string[] }
    | { type: "redacted_thinking"; data: string; signature?: string }
    | { type: "tool_use"; index: number };

/** 单条流的累加器（工厂闭包持有；诊断字段与白盒测试可见）。 */
type AnthropicSseParserState = SseParseDiagnostics & {
    buffer: string;
    blocks: ContentBlock[];
    active: ActiveBlock | null;
    toolUses: ToolUseAccumulator[];
    /** message_start 事件原文（输入侧 usage / model 在这里，message_delta 会覆盖不到它）。 */
    messageStartRaw: unknown;
    /** message_delta 事件原文（累计 output_tokens / stop_reason 在这里）。 */
    messageDeltaRaw: unknown;
    /** 上一次 usage 事件 emit 的输出侧累计值（值不变不重发；undefined = 尚未 emit）。 */
    lastEmittedCompletionTokens: number | undefined;
    degradedToolCalls: DegradedToolCall[];
};

export type AnthropicSseParserOptions = {
    readonly onStream?: (event: LlmStreamEvent) => void;
    readonly toolNames?: AnthropicToolNameWire;
};

type AnthropicSseParserHandle = {
    readonly state: AnthropicSseParserState;
    readonly feed: (chunk: string) => void;
    readonly finish: () => SseFinishResult;
    readonly finishPartial: () => SseFinishResult;
};

export const AnthropicSseParser = {
    flushActiveBlock(state: AnthropicSseParserState, onStream?: (event: LlmStreamEvent) => void, toolNames?: AnthropicToolNameWire): void {
        const active = state.active;
        if (active == null) {
            return;
        }

        switch (active.type) {
            case "text": {
                const text = active.parts.join("");
                if (text !== "") {
                    state.blocks.push({ type: "text", text });
                }
                break;
            }
            case "thinking": {
                const text = active.text.join("");
                const signature = active.signature.join("");
                if (text !== "" || signature !== "") {
                    state.blocks.push({
                        type: "thinking",
                        text,
                        ...(signature !== "" ? { thinkingSignature: signature } : {}),
                    });
                }
                break;
            }
            case "redacted_thinking": {
                state.blocks.push({
                    type: "redacted_thinking",
                    data: active.data,
                    ...(active.signature != null ? { thinkingSignature: active.signature } : {}),
                });
                break;
            }
            case "tool_use": {
                const tu = state.toolUses[active.index];
                if (tu != null) {
                    const parsed = ToolArguments.tryParseJson(tu.inputJson);
                    const name = toolNames?.fromWire(tu.name) ?? tu.name;
                    let input: Record<string, unknown>;
                    if (parsed.ok) {
                        input = parsed.value;
                    } else {
                        input = {};
                        state.degradedToolCalls.push({
                            id: tu.id,
                            name,
                            rawArguments: parsed.raw,
                            reason: "INVALID_TOOL_ARGUMENTS",
                        });
                    }
                    state.blocks.push({
                        type: "tool_use",
                        id: tu.id,
                        name,
                        input,
                    });
                    onStream?.({
                        type: "tool-use",
                        id: tu.id,
                        name,
                        input,
                    });
                }
                break;
            }
        }

        state.active = null;
    },

    ensureActiveThinking(state: AnthropicSseParserState): Extract<ActiveBlock, { type: "thinking" }> {
        if (state.active?.type === "thinking") {
            return state.active;
        }
        AnthropicSseParser.flushActiveBlock(state);
        const active: Extract<ActiveBlock, { type: "thinking" }> = {
            type: "thinking",
            text: [],
            signature: [],
        };
        state.active = active;
        return active;
    },

    /**
   * 合并 message_start / message_delta 双槽为单个 raw。
   *
   * usage 取 start 的输入侧（input_tokens + cache 字段）+ delta 的累计 output_tokens；
   * model 取 start；stop_reason 等其他顶层字段保留 delta 的。
   * 仅单槽有值时原样返回；两槽皆空返回 undefined（调用方自行降级）。
   */
    mergeStreamRaw(state: AnthropicSseParserState): unknown {
        const start = state.messageStartRaw;
        const delta = state.messageDeltaRaw;
        if (!Guards.isRecord(start)) {
            return delta;
        }
        if (!Guards.isRecord(delta)) {
            return start;
        }
        const merged: Record<string, unknown> = { ...delta };
        // message_start 的 model / usage 嵌在 message 下，非流式形态才是顶层，两种都兼容。
        const startMessage = Guards.isRecord(start.message) ? start.message : undefined;
        if (typeof startMessage?.model === "string") {
            merged.model = startMessage.model;
        } else if (typeof start.model === "string") {
            merged.model = start.model;
        }
        let startUsage: Record<string, unknown> | undefined;
        if (startMessage != null && Guards.isRecord(startMessage.usage)) {
            startUsage = startMessage.usage;
        } else if (Guards.isRecord(start.usage)) {
            startUsage = start.usage;
        }
        const usage: Record<string, unknown> = {};
        if (startUsage != null) {
            const inputSideKeys = [ANTHROPIC_USAGE_FIELDS.prompt, ANTHROPIC_USAGE_FIELDS.cacheRead, ANTHROPIC_USAGE_FIELDS.cacheCreationFlat, ANTHROPIC_USAGE_FIELDS.cacheCreationNested];
            for (const key of inputSideKeys) {
                if (startUsage[key] != null) {
                    usage[key] = startUsage[key];
                }
            }
        }
        if (Guards.isRecord(delta.usage) && delta.usage.output_tokens != null) {
            usage.output_tokens = delta.usage.output_tokens;
        }
        if (Object.keys(usage).length > 0) {
            merged.usage = usage;
        }
        return merged;
    },

    /** 创建一个单流 Anthropic SSE parser；`state` 持有本次流的全部累加器。 */
    create(options: AnthropicSseParserOptions = {}): AnthropicSseParserHandle {
        const onStream = options.onStream;
        const toolNames = options.toolNames;
        const state: AnthropicSseParserState = {
            buffer: "",
            blocks: [],
            active: null,
            toolUses: [],
            messageStartRaw: undefined,
            messageDeltaRaw: undefined,
            lastEmittedCompletionTokens: undefined,
            malformedLineCount: 0,
            degradedToolCalls: [],
        };

        // nm-style: keep-closure — per-stream handle 动词（闭包生命周期=单条流），feed 还以值传给 SseLineBuffer.drain（API 契约要求闭包形态）；handle 形态是适配器与白盒测试的契约。
        const feed = (chunk: string): void => {
            SseJsonEvents.feed(state, chunk, (event) => {
                const type = event.type;
                if (type === "message_start") {
                    state.messageStartRaw = event;
                } else if (type === "message_delta") {
                    state.messageDeltaRaw = event;
                    const usage = UsageParser.parse("anthropic", state.messageDeltaRaw);
                    const completionTokens = usage?.completionTokens;
                    if (usage != null && completionTokens != null && completionTokens !== state.lastEmittedCompletionTokens) {
                        state.lastEmittedCompletionTokens = completionTokens;
                        onStream?.({ type: "usage", usage });
                    }
                }
                if (type === "content_block_start") {
                    AnthropicSseParser.flushActiveBlock(state, onStream, toolNames);
                    const block = event.content_block;
                    if (!Guards.isRecord(block) || typeof block.type !== "string") {
                        return;
                    }
                    if (block.type === "tool_use") {
                        state.toolUses.push({
                            id: typeof block.id === "string" ? block.id : "",
                            name: typeof block.name === "string" ? block.name : "",
                            inputJson: "",
                        });
                        state.active = { type: "tool_use", index: state.toolUses.length - 1 };
                    } else if (block.type === "thinking") {
                        state.active = { type: "thinking", text: [], signature: [] };
                    } else if (block.type === "redacted_thinking") {
                        const data = typeof block.data === "string" ? block.data : "";
                        const signature = typeof block.signature === "string" && block.signature !== "" ? block.signature : undefined;
                        state.active = { type: "redacted_thinking", data, signature };
                    } else if (block.type === "text") {
                        state.active = { type: "text", parts: [] };
                    }
                } else if (type === "content_block_delta") {
                    const delta = event.delta;
                    if (!Guards.isRecord(delta)) {
                        return;
                    }
                    if (delta.type === "text_delta" && typeof delta.text === "string") {
                        // 非 text active 先收尾，再切到新的 text 块。
                        let activeText = state.active;
                        if (activeText?.type !== "text") {
                            AnthropicSseParser.flushActiveBlock(state);
                            activeText = { type: "text", parts: [] };
                            state.active = activeText;
                        }
                        activeText.parts.push(delta.text);
                        onStream?.({ type: "text-delta", text: delta.text });
                    } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
                        AnthropicSseParser.ensureActiveThinking(state).text.push(delta.thinking);
                        onStream?.({ type: "thinking-delta", text: delta.thinking });
                    } else if (delta.type === "signature_delta" && typeof delta.signature === "string") {
                        // Claude 4+ streams opaque signature fragments before content_block_stop.
                        AnthropicSseParser.ensureActiveThinking(state).signature.push(delta.signature);
                    } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && state.active?.type === "tool_use") {
                        const tu = state.toolUses[state.active.index]!;
                        tu.inputJson += delta.partial_json;
                    }
                } else if (type === "content_block_stop") {
                    AnthropicSseParser.flushActiveBlock(state, onStream, toolNames);
                }
            });
        };

        // nm-style: keep-closure — 同族 handle 动词；抽取需自建 lambda 重建对 feed 的 drain 引用，零收益。
        const finish = (): SseFinishResult => {
            SseLineBuffer.drain(state, feed);
            AnthropicSseParser.flushActiveBlock(state, onStream, toolNames);
            // nm-throw: keep — 断言失败沿 parser 既有 throw 通道上行（transport catch → reject），不新增构造。
            const asserted = SseParseErrors.assertSucceededOrThrow(state, state.blocks, "anthropic");
            // nm-throw: keep — parser 既有 throw 通道上行（transport catch → reject）。
            if (!asserted.ok) throw asserted.error;
            return {
                blocks: state.blocks,
                streamRaw: AnthropicSseParser.mergeStreamRaw(state),
                degradedToolCalls: state.degradedToolCalls,
            };
        };

        // nm-style: keep-closure — 同族 handle 动词，捕获集与 finish 高度重叠（state,feed,onStream,toolNames）；要动必须三动词同族一次性同构抽取，不可单独动一个。
        const finishPartial = (): SseFinishResult => {
            SseLineBuffer.drain(state, feed);
            AnthropicSseParser.flushActiveBlock(state, onStream, toolNames);

            const stateTextBlocks = state.blocks.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text");
            const text = stateTextBlocks.map((b) => b.text).join("");
            const stateThinkingBlocks = state.blocks.filter((b): b is Extract<ContentBlock, { type: "thinking" }> => b.type === "thinking");
            const thinking = stateThinkingBlocks.map((b) => b.text).join("");
            // thinking 文本级签名：取**最后一个非空** thinkingSignature（与 gemini 的
            // `state.thinkingSignature`「后到覆盖」语义一致）。
            const thinkingSignature = stateThinkingBlocks.reduce<string | undefined>((acc, b) => (b.thinkingSignature != null ? b.thinkingSignature : acc), undefined);
            const toolUses = state.blocks
                .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
                .map((b) => ({
                    id: b.id,
                    name: b.name,
                    input: b.input,
                    // 块上本就带签名，partial 侧必须透传（不传 ⇒ 中断收尾的 tool_use 比
                    // 正常收尾少签名，回传时 400）。
                    ...(b.thinkingSignature != null ? { thinkingSignature: b.thinkingSignature } : {}),
                }));
            const otherBlocks = state.blocks.filter((b) => b.type !== "text" && b.type !== "thinking" && b.type !== "tool_use");

            const blocks = StreamPartialBlocks.build({ text, thinking, thinkingSignature, toolUses }, onStream);
            blocks.push(...otherBlocks);

            return {
                blocks,
                streamRaw: AnthropicSseParser.mergeStreamRaw(state) ?? ({ streamed: true, aborted: true } as Record<string, unknown>),
                degradedToolCalls: [],
            };
        };

        return { state, feed, finish, finishPartial };
    },
} as const;
