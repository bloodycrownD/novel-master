/**
 * LLM SSE HTTP transport: registered native transport, fetch stream body, or
 * React Native XMLHttpRequest.
 *
 * 传输三分支逐请求择优（spec llm-stream-native §3）：registered native →
 * XHR → fetch。native transport 经 {@link LlmSseTransport.register} 由 app 装配层
 * 注册（先例：configureLlmFetch / registerOpSqliteDriver），core 不 import
 * 原生包——接口鸭子类型。每次 `post` 调用都重新检查注册位（运行时判定，
 * 非进程启动时定死）：native 未注册/加载失败时同进程内自动回落 XHR。
 *
 * fetch 与 XHR 两条路径共享 {@link SseDispatch.dispatchChunk} 分发语义（A-23）：解码后的
 * chunk 统一经 dispatchChunk 转发，首包日志只打一次。pacing 差异仍按传输介质
 * 区分——fetch/native 每个 chunk 直投 onChunk（Desktop/CLI 与 native 合批流的
 * 异步到达天然让步，无需节流），XHR 走 {@link SseChunkEmitter.create} 的 32ms
 * 整流（RN burst 平滑）。真正的 SSE 帧解析（data: / \n\n / event 字段）由下游
 * *-sse-parser 经 feedLines 增量处理，跨路径一致。详见
 * `.apm/kb/docs/Iterations/mobile-sse-stream-resilience/spec.md`。
 *
 * 黑洞挂死根治（spec llm-stream-timeout 回炉版 + llm-stream-native 修订，
 * 两层防御；时序装配上移到 post 公共层，三分支共用 settle 守卫，分支内
 * 只留传输专属清理——XHR abort / fetch controller.abort / native 经
 * opts.signal 断流）：
 * 1. XHR 路径请求带 `Connection: close`——**条件化**（spec llm-stream-native
 *    §7）：仅当本次请求未走 registered native transport（即运行时判定回落
 *    XHR）时设置。native 管子黑洞由整调用 callTimeout 兜底，不设 close
 *    以保留连接复用；回落 XHR 时死连接复用黑洞仍由 close 消灭。OkHttp
 *    尊重请求侧 close，连接用完即废不回池；h2 下该头被协议剥离（无害），
 *    由 2 兜底。该条件由分支派发表达（XHR 分支只在 registered transport
 *    缺席时执行，分支内无条件设置 close），不再写恒真判断。
 * 2. 整调用兜底 `SSE_WHOLE_CALL_TIMEOUT_MS`：触发机制按分支表达——XHR 经
 *    `xhr.timeout`（RN 0.85.3 映射 OkHttp callTimeout，覆盖 connect/写/读
 *    全周期）；fetch 经公共层 whole-call 定时器 + controller.abort；native
 *    经 transport 内 callTimeout（到点以超时形态错误抛出，本文件按错误形态
 *    识别并映射同一分级）。到点按「是否已收到响应数据」分级——0 字节 =
 *    first-chunk（黑洞，可重试且天然走新连接）；有输出 = idle（不自动重试）。
 *
 * 已移除：流空闲看门狗（原 idle 30s 自动断流，见下方淘汰记录）——流式的
 * 合法停顿（思考、GLM 工具调用非流段服务端憋生成、排队）与死流无法区分，
 * 固定阈值必然误杀；死流现由用户手动终止 + 整调用预算兜底。
 *
 * @module infra/llm-protocol/logic/llm-sse-transport
 */

import { Text } from "@/common/text.js";
import { AppError } from "@/errors/app-error.js";
import { LogFactory } from "@/infra/log/logger.js";
import type { FetchFn } from "../ports/adapter.port.js";
import { SseChunkEmitter } from "./sse-chunk-emitter.js";
import { SseDispatch } from "./dispatch-sse-chunk.js";
import { HttpUtil } from "./http-util.js";

const log = LogFactory.create("llm.sse-transport");

export type SseByteHandler = (chunk: string) => void;

/** {@link LlmSseTransport.post} 的参数对象（>4 参收口）：原 PostSseOptions 字段展平，providerId 同对象并列。 */
export type SsePostParams = {
    readonly url: string;
    readonly init: RequestInit;
    /** UTF-8 解码后的文本增量回调（只搬字节不认协议）。 */
    readonly onChunk: SseByteHandler;
    /** 服务商 id（错误构造与日志归因用）。 */
    readonly providerId?: string;
    readonly fetchFn?: FetchFn;
    readonly signal?: AbortSignal;
    readonly logTag?: string;
};

/**
 * SSE 传输 port（spec llm-stream-native §3）：把「发起请求 + 增量投递解码后
 * 文本 chunk」抽象为可注册实现，opts 字段与 {@link SsePostParams} 逐字段对应。
 *
 * - `post` 语义与 LlmSseTransport.post 一致：HTTP 2xx 流结束 resolve `{status, contentType}`；
 *   非 2xx / 网络失败 reject（ProviderError 形态或 transport 自有错误）；
 *   响应数据以 UTF-8 解码后的文本增量经 `onChunk` 投递（只搬字节不认协议，
 *   SSE 帧解析留在 core）。
 * - `init` 为标准 RequestInit（method/headers/body）；`options.fetchFn` 不进
 *   port——port 自带传输。
 * - 超时契约（native callTimeout 到点）：抛出 name 为 `"LlmSseTimeoutError"`
 *   或携带 `kind === "timeout"` 字段的 Error，post 公共层识别后映射
 *   PROVIDER_STREAM_TIMEOUT 分级（已收数据 → idle；0 数据 →
 *   first-chunk 可重试）。
 * - abort 语义走 `opts.signal`：signal abort 后 transport 应停止投递并
 *   reject（AbortError 形态或等价）；公共层超时 settle 后同样 abort 该
 *   signal 主动断流（wrapper 侧转发到原生 sseAbort）。用户取消（signal
 *   abort）抛出的错误原样上抛，与 `RequestAbort.isAborted` 判据链路兼容。
 * - `opts.wholeCallTimeoutMs` 为整调用兜底预算（毫秒），由 core 单点下发
 *   （{@link SSE_WHOLE_CALL_TIMEOUT_MS}）：实现应以之覆盖自身 callTimeout
 *   配置；缺省时回退实现默认（native 侧保留 Kotlin 默认 600s 作后备），
 *   避免预算口径在各层各写一份。
 */
export interface SseTransport {
    post(
        url: string,
        init: RequestInit,
        onChunk: SseByteHandler,
        opts?: {
            providerId?: string;
            signal?: AbortSignal;
            logTag?: string;
            /** 整调用兜底预算（毫秒），core 单点下发；缺省由实现回退自身默认。 */
            wholeCallTimeoutMs?: number;
        }
    ): Promise<{ status: number; contentType: string | null }>;
}

/** 传输注册槽（模块内 holder，对象管理）：真实注册位与测试强制位，逐请求判定用。 */
const transportSlots = {
    registered: undefined as SseTransport | undefined,
    overrideForTests: undefined as SseTransport | undefined,
};

const DEFAULT_LOG_TAG = "[novel-master/llm-sse]";

/**
 * 整调用兜底预算：connect + 写请求体 + 服务端处理 + 读响应体全周期上限。
 * 取值须显著大于最长健康流（200 t/s 下 10 分钟 ≈ 120K token 单次输出）；
 * 触发时按是否已收到数据分级（first-chunk/idle），见类文档注释第 2 条。
 */
export const SSE_WHOLE_CALL_TIMEOUT_MS = 600_000;

/** Minimal XHR surface used by SSE transport (Node types omit DOM lib). */
type SseXmlHttpRequest = {
    open(method: string, url: string): void;
    setRequestHeader(name: string, value: string): void;
    send(body: unknown): void;
    abort(): void;
    responseText: string;
    status: number;
    /** OkHttp callTimeout 毫秒值（RN 0.85.3 起 send 时读取并生效）。 */
    timeout: number;
    onprogress: (() => void) | null;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    ontimeout: (() => void) | null;
    getResponseHeader(name: string): string | null;
};

type SseXmlHttpRequestConstructor = new () => SseXmlHttpRequest;

function getXmlHttpRequestCtor(): SseXmlHttpRequestConstructor | undefined {
    return (globalThis as { XMLHttpRequest?: SseXmlHttpRequestConstructor }).XMLHttpRequest;
}

/** RN 判定缓存与测试强制位（模块内 holder，对象管理）。 */
const xhrSelection = {
    /** 进程寿命内缓存的 RN 判定结果。 */
    cached: undefined as boolean | undefined,
    /** @internal Test hook to force or clear transport selection. */
    overrideForTests: undefined as boolean | undefined,
};

/** post 成功终态载荷（resolveOnce 与 SseTransport.post 共用形状）。 */
type SsePostResult = { status: number; contentType: string | null };

/** 分发台账形状（dispatch-sse-chunk 内部类型，推导引用）。 */
type SseDispatchState = ReturnType<typeof SseDispatch.createState>;

/** XHR 分支整流 emitter 的 handle 形状（sse-chunk-emitter 内部类型，推导引用）。 */
type SseEmitterHandle = ReturnType<typeof SseChunkEmitter.create>;

/**
 * 单次 post 的 per-request 编排槽：settle-once 守卫、whole-call 定时器、观测
 * 计数与 XHR 游标进同一 ctx，模块函数族共享——变异共享由槽承载而不是复制值。
 */
type SsePostSettleCtx = {
    /** settle-once 终态守卫（onprogress/onload 与迟到错误回调也直读）。 */
    settled: boolean;
    /** 已收响应数据累计字符数（超时分级判据）。 */
    processedLength: number;
    /** 最近一次响应数据到达时刻（诊断）。 */
    lastActivityAt: number;
    /** 分支注册的断流钩子（超时 settle 后主动断流）：XHR 为 xhr.abort；fetch 与 native 为 controller.abort（native 经 opts.signal 由 wrapper 转发到原生 sseAbort）。 */
    abortStream: (() => void) | undefined;
    /** 分支注册的终态清理钩子（XHR 的 emitter.dispose 等，幂等）。 */
    cleanupBranch: (() => void) | undefined;
    /** whole-call JS 定时器槽（仅 fetch 分支启用；XHR 用原生 xhr.timeout、native 用 transport 内 callTimeout，避免双触发竞态）。 */
    wholeCallTimer: ReturnType<typeof setTimeout> | null;
    /** XHR responseText 消费游标（deliverNewText 的 slice 起点，跨回调推进）。 */
    xhrCursor: number;
    /** 以 rejectOnce 语义 settle 失败终态（handleWholeCallTimeout 专用入口）。 */
    settleReject: (error: Error) => void;
    /** 日志标签（超时日志用）。 */
    logTag: string;
};

/** native 分支单次 chunk 投递参数（>4 参收口，{@link SsePostSettle.deliverNativeChunk}）。 */
type SseNativeChunkParams = { readonly ctx: SsePostSettleCtx; readonly state: SseDispatchState; readonly onChunk: SseByteHandler; readonly logTag: string; readonly chunk: string };

/** XHR 分支新文本投递参数（>4 参收口，{@link SsePostSettle.deliverNewText}）。 */
type SseNewTextParams = { readonly ctx: SsePostSettleCtx; readonly xhr: SseXmlHttpRequest; readonly state: SseDispatchState; readonly emitter: SseEmitterHandle; readonly logTag: string };

/**
 * settle / 投递族（同主体：SsePostSettleCtx 生命周期）——7 个操作收同一 namespace，
 * ctx 显式传参形态不变（纯机械重组，体与顺序逐字保持）。
 */
const SsePostSettle = {
    /** 清 whole-call 定时器槽（仅 fetch 分支启用；幂等）。 */
    clearTimer(ctx: SsePostSettleCtx): void {
        if (ctx.wholeCallTimer != null) {
            clearTimeout(ctx.wholeCallTimer);
            ctx.wholeCallTimer = null;
        }
    },

    /** settle-once resolve：先抢占 settled 守卫，再清定时器，最后兑现（顺序不可动）。 */
    resolveOnce(ctx: SsePostSettleCtx, resolve: (value: SsePostResult) => void, value: SsePostResult): void {
        if (ctx.settled) return;
        ctx.settled = true;
        SsePostSettle.clearTimer(ctx);
        resolve(value);
    },

    /** settle-once reject（transport 边界的 Promise reject 通道，throw 语义不变）：顺序同 resolveOnce。 */
    rejectOnce(ctx: SsePostSettleCtx, reject: (error: Error) => void, error: Error): void {
        if (ctx.settled) return;
        ctx.settled = true;
        SsePostSettle.clearTimer(ctx);
        reject(error);
    },

    /** 响应数据到达（含空增量/解码滞后的增量）：`bytes` 为本次解码后新增字符数。 */
    noteActivity(ctx: SsePostSettleCtx, bytes: number): void {
        ctx.lastActivityAt = Date.now();
        ctx.processedLength += bytes;
    },

    /**
   * 整调用兜底公共语义（回炉版 spec 第 2 节）：到点按「是否已收到响应数据」
   * 分级——黑洞 0 字节 → first-chunk（可重试，Connection: close 保证重试走
   * 新连接）；健康长流超预算（有输出）→ idle（不自动重试，走失败链）。
   * 触发机制按分支表达：XHR `xhr.timeout` 到点回调 / fetch whole-call
   * 定时器 / native transport 超时错误映射（detail 区分来源）；`bufferedBytes`
   * 由三个触发点各自绑定（读值时刻=超时触发时刻，不再走可重绑槽）。
   */
    handleWholeCallTimeout(ctx: SsePostSettleCtx, bufferedBytes: () => number, detail?: string): void {
        if (ctx.settled) {
            // 迟到的触发与其它 settle 来源竞态：丢弃。
            return;
        }
        const phase = ctx.processedLength > 0 ? "idle" : "first-chunk";
        LlmSseTransport.logSse(ctx.logTag, "stream timeout", {
            phase,
            source: detail ?? "whole-call",
            lastActivityAt: ctx.lastActivityAt,
            processedLength: ctx.processedLength,
            bufferedBytes: bufferedBytes(),
        });
        // LlmStreamTimeoutError 已退役为 AppError("PROVIDER_STREAM_TIMEOUT")：phase/timeoutMs 进 params
        // （重试分级经 details.phase 判），detail 承载原动态 message 文案（失败链占位文案依赖它）。
        const budget = detail ?? "whole-call budget";
        let timeoutDetail: string;
        if (phase === "first-chunk") {
            timeoutDetail = `LLM stream timed out after ${SSE_WHOLE_CALL_TIMEOUT_MS}ms waiting for the first chunk (${budget})`;
        } else {
            timeoutDetail = `LLM stream idle for ${SSE_WHOLE_CALL_TIMEOUT_MS}ms after the last chunk (${budget})`;
        }
        ctx.settleReject(new AppError("PROVIDER_STREAM_TIMEOUT", { phase, timeoutMs: SSE_WHOLE_CALL_TIMEOUT_MS, detail: timeoutDetail }));
        ctx.abortStream?.();
        ctx.cleanupBranch?.();
    },

    /** native 分支 chunk 投递（wrapper 多次异步调用）：观测计数与首包台账经 ctx/state 共享，裸参数化会拆散台账。 */
    deliverNativeChunk(p: SseNativeChunkParams): void {
        SsePostSettle.noteActivity(p.ctx, p.chunk.length);
        SseDispatch.dispatchChunk(p.chunk, p.state, p.onChunk, (bytes) => LlmSseTransport.logSse(p.logTag, "native first chunk", { bytes }));
    },

    /** XHR 分支新文本投递：按 ctx.xhrCursor 切增量，游标与观测计数经 ctx 原子推进（settled 守卫由调用侧直读）。 */
    deliverNewText(p: SseNewTextParams): void {
        const text = p.xhr.responseText;
        if (text.length <= p.ctx.xhrCursor) {
            return;
        }
        const chunk = text.slice(p.ctx.xhrCursor);
        p.ctx.xhrCursor = text.length;
        SsePostSettle.noteActivity(p.ctx, chunk.length);
        // 经公共 dispatchChunk 转发到 emitter（节流由 emitter 负责），首包日志统一在此。
        SseDispatch.dispatchChunk(chunk, p.state, p.emitter.append, (bytes) => LlmSseTransport.logSse(p.logTag, "xhr first chunk", { bytes }));
    },
} as const;

export const LlmSseTransport = {
    /**
   * 注册/注销 SSE 传输实现（app 装配层调用；mobile 注册 native 管子，
   * desktop/CLI 不注册、零变化）。传 `undefined` 注销——逐请求运行时判定，
   * 注销后同进程内自动回落 XHR/fetch（`Connection: close` 条件化的前提，
   * spec §7）。
   */
    register(transport: SseTransport | undefined): void {
        transportSlots.registered = transport;
    },

    /** @internal Test hook: force a fake transport; `undefined` restores. */
    setOverrideForTests(transport: SseTransport | undefined): void {
        transportSlots.overrideForTests = transport;
    },

    /** @internal Reset cached RN detection and transport test overrides. */
    resetShouldUseXhrCacheForTests(): void {
        xhrSelection.cached = undefined;
        xhrSelection.overrideForTests = undefined;
        transportSlots.overrideForTests = undefined;
    },

    /** @internal Force XHR/fetch branch in tests. */
    setShouldUseXhrOverrideForTests(value: boolean | undefined): void {
        xhrSelection.overrideForTests = value;
        xhrSelection.cached = undefined;
    },

    /**
   * True on React Native where fetch streaming bodies are unavailable.
   * Result is cached for the process lifetime.
   */
    shouldUseXhr(): boolean {
        if (xhrSelection.overrideForTests !== undefined) {
            return xhrSelection.overrideForTests;
        }
        if (xhrSelection.cached !== undefined) {
            return xhrSelection.cached;
        }
        // RN exposes XMLHttpRequest and sets navigator.product; Node/CLI do not.
        xhrSelection.cached = getXmlHttpRequestCtor() != null && (globalThis as { navigator?: { product?: string } }).navigator?.product === "ReactNative";
        return xhrSelection.cached;
    },

    logSse(logTag: string, message: string, detail?: Record<string, unknown>): void {
        if (process.env.NM_DEBUG_LLM_FETCH !== "1") {
            const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean; __DEV__?: boolean };
            if (g.__NM_DEBUG_LLM_FETCH__ !== true && g.__DEV__ !== true) {
                return;
            }
        }
        log.debug(message, detail == null ? { logTag } : { logTag, ...detail });
    },

    /**
   * POST and deliver SSE text chunks incrementally (UTF-8 decoded strings).
   * HTTP 4xx/5xx throw `PROVIDER_HTTP_ERROR` AppError.
   *
   * 传输三分支逐请求择优（registered native → XHR → fetch）；whole-call
   * 语义与 settle 守卫在公共层装配（见模块文档）。
   */
    post(p: SsePostParams): Promise<{ status: number; contentType: string | null }> {
        const { url, init, onChunk, providerId } = p;
        const logTag = p.logTag ?? DEFAULT_LOG_TAG;
        const signal = p.signal ?? init.signal ?? undefined;
        const method = init.method ?? "POST";

        // 三分支逐请求运行时判定（spec §3）：registered native → XHR → fetch。
        // 测试强制位优先于真实注册位；native 未注册时同进程自动回落 XHR。
        const transport = transportSlots.overrideForTests ?? transportSlots.registered;
        const usedRegisteredTransport = transport != null;
        let kind: "native" | "xhr" | "fetch";
        if (usedRegisteredTransport) {
            kind = "native";
        } else if (LlmSseTransport.shouldUseXhr()) {
            kind = "xhr";
        } else {
            kind = "fetch";
        }

        LlmSseTransport.logSse(logTag, "→", { method, url, transport: kind });

        return new Promise((resolve, reject) => {
            // ===== 公共层（whole-call / settle 守卫上移，三分支共用）=====
            // per-request 编排槽：settle-once 守卫、whole-call 定时器、观测计数与
            // XHR 游标进同一 ctx（模块函数族共享；settle-once 顺序逐字保持——先
            // 抢占 settled，再清定时器/断流清理，防 isRequestAborted 吞成 partial）。
            const ctx: SsePostSettleCtx = {
                settled: false,
                processedLength: 0,
                lastActivityAt: Date.now(),
                abortStream: undefined,
                cleanupBranch: undefined,
                wholeCallTimer: null,
                xhrCursor: 0,
                settleReject: (error) => SsePostSettle.rejectOnce(ctx, reject, error),
                logTag,
            };

            // 淘汰记录：流空闲看门狗（原 idle 30s 自动断流）已按产品拍板移除——
            // 流式的合法停顿（思考、工具调用非流段服务端憋生成、排队）与死流无法
            // 区分，固定阈值必然误杀（GLM tool_stream 默认 false 实锤）。流式现在
            // 唯一的自动兜底是整调用预算（callTimeout/xhr.timeout/whole-call 定时器），
            // 死流由用户手动终止。settle 守卫时序（先抢占 settle、再断流清理，防
            // isRequestAborted 吞成 partial）仍由下方分支沿用。

            // ===== 分支执行（分支内只保留传输专属清理）=====

            if (transport != null) {
                /**
         * native 分支：registered transport 承载传输（合批后的 chunk 事件由
         * wrapper 转成 onChunk 调用）。whole-call 语义在公共层：
         * callTimeout 由 transport 内部承接（超时按契约形态抛错），公共层
         * 不再开 JS 定时器避免双触发竞态。
         *
         * abort 语义走 opts.signal（与 fetch 分支同构）：用户 signal（停止
         * 生成）与公共层超时断流共用一个组合 controller，wrapper 侧监听并
         * 转发到原生 sseAbort。用户取消抛 AbortError 形态原样上抛，
         * isRequestAborted 判据链路保持兼容。
         */
                const controller = new AbortController();
                if (signal != null) {
                    if (signal.aborted) {
                        controller.abort();
                    } else {
                        signal.addEventListener("abort", () => controller.abort(), { once: true });
                    }
                }
                ctx.abortStream = () => controller.abort();

                const dispatchState = SseDispatch.createState();
                // 整调用预算单点下发（core-transport/C-orch-1）：wrapper 以之覆盖
                // timeouts.callMs；缺省时回退 Kotlin 默认 600s 作后备。
                const postOptions = { providerId, signal: controller.signal, logTag, wholeCallTimeoutMs: SSE_WHOLE_CALL_TIMEOUT_MS };

                // native 侧已合批（~10 事件/s），JS 侧直投（与 fetch 同款即时转发）。
                void transport.post(url, init, (chunk) => SsePostSettle.deliverNativeChunk({ ctx, state: dispatchState, onChunk, logTag, chunk }), postOptions).then(
                    (result) => {
                        SsePostSettle.resolveOnce(ctx, resolve, result);
                    },
                    (error: unknown) => {
                        if (ctx.settled) {
                            // 公共层已以超时错误 settle：断流导致的迟到错误在此丢弃，
                            // 不让它顶替/竞态超时错误。
                            return;
                        }
                        const transportError = typeof error === "object" && error !== null ? (error as { name?: unknown; kind?: unknown }) : undefined;
                        if (transportError != null && (transportError.name === "LlmSseTimeoutError" || transportError.kind === "timeout")) {
                            // native 整调用 callTimeout 到点：映射同一分级语义（spec §3，T-N2）。
                            // detail 透传 wrapper 错误的真实信息；终版无流式空闲界，
                            // SocketTimeoutException 仅存防御性文案路径。
                            SsePostSettle.handleWholeCallTimeout(ctx, () => 0, `native timeout: ${error instanceof Error ? error.message : String(error)}`);
                            return;
                        }
                        SsePostSettle.rejectOnce(ctx, reject, error instanceof Error ? error : new Error(String(error)));
                    }
                );
            } else if (kind === "xhr") {
                /** XHR 分支：RN 上 fetch 无流式 body 时的主力路径（无 native 注册时）。 */
                const XhrCtor = getXmlHttpRequestCtor();
                if (XhrCtor == null) {
                    SsePostSettle.rejectOnce(ctx, reject, new AppError("PROVIDER_HTTP_ERROR", { detail: "XMLHttpRequest is not available in this environment", providerId }));
                    return;
                }

                const xhr = new XhrCtor();
                const dispatchState = SseDispatch.createState();
                const emitter = SseChunkEmitter.create(onChunk);

                ctx.abortStream = () => xhr.abort();
                ctx.cleanupBranch = () => emitter.dispose();

                xhr.open(init.method ?? "POST", url);
                // 整调用兜底（回炉版 spec 第 2 节）：RN 0.85.3 将 xhr.timeout 映射为
                // OkHttp callTimeout（克隆 builder，共享池/分发器），覆盖 connect/写/读
                // 全周期——死连接黑洞（四超时全 0 下读永久阻塞）的唯一确定性下界。
                // 到点回调走公共层 handleWholeCallTimeout 统一分级。
                xhr.timeout = SSE_WHOLE_CALL_TIMEOUT_MS;

                if (signal != null) {
                    if (signal.aborted) {
                        emitter.dispose();
                        SsePostSettle.rejectOnce(ctx, reject, new AppError("PROVIDER_HTTP_ERROR", { detail: "Request aborted", providerId }));
                        return;
                    }
                    signal.addEventListener("abort", () => xhr.abort(), { once: true });
                }

                xhr.onprogress = () => {
                    // settle 即终态：超时/中止抢占 settle 后，RN 可能仍补发迟到进度
                    // 回调（run 上与 ontimeout 竞态），此时不得再投递任何数据。
                    if (ctx.settled) return;
                    // 任何响应数据到达（含 UTF-8 解码滞后的空增量）：更新观测打点
                    //（lastActivityAt / processedLength），不参与任何超时判定。
                    SsePostSettle.noteActivity(ctx, 0);
                    SsePostSettle.deliverNewText({ ctx, xhr, state: dispatchState, emitter, logTag });
                };

                // 整调用预算耗尽（callTimeout 到点，RN dispatch 'timeout' 事件）：
                // 分级与 settle 语义在公共层 handleWholeCallTimeout；rejectOnce 抢占
                // settle 后，RN 后续可能补发的 load/error/abort 回调被 settled 守卫丢弃。
                xhr.ontimeout = () => {
                    SsePostSettle.handleWholeCallTimeout(ctx, () => emitter.bufferedLength());
                };

                xhr.onload = () => {
                    // settle 即终态：超时/中止 settle 后迟到的完成回调不得补投 tail、
                    // 也不得用 resolve/reject 顶替既有终态。
                    if (ctx.settled) return;
                    SsePostSettle.deliverNewText({ ctx, xhr, state: dispatchState, emitter, logTag });
                    // Synchronous flush on complete: no async drain chain; guarantees tail delivery.
                    const tail = emitter.flush();
                    if (tail.length > 0) {
                        onChunk(tail);
                    }

                    const status = xhr.status;
                    const contentType = xhr.getResponseHeader("Content-Type");
                    LlmSseTransport.logSse(logTag, "xhr complete", { status, contentType });

                    if (status < 200 || status >= 300) {
                        const body = xhr.responseText;
                        const snippet = Text.truncate(body, 500);
                        SsePostSettle.rejectOnce(ctx, reject, new AppError("PROVIDER_HTTP_ERROR", { detail: `HTTP ${status}: ${snippet}`, providerId }));
                        return;
                    }

                    SsePostSettle.resolveOnce(ctx, resolve, { status, contentType });
                };

                xhr.onerror = () => {
                    emitter.dispose();
                    SsePostSettle.rejectOnce(ctx, reject, new AppError("PROVIDER_HTTP_ERROR", { detail: "XHR network error", providerId }));
                };

                xhr.onabort = () => {
                    emitter.dispose();
                    SsePostSettle.rejectOnce(ctx, reject, new AppError("PROVIDER_HTTP_ERROR", { detail: "Request aborted", providerId }));
                };

                const headers = init.headers;
                if (headers != null) {
                    if (headers instanceof Headers) {
                        headers.forEach((value, key) => {
                            xhr.setRequestHeader(key, value);
                        });
                    } else if (Array.isArray(headers)) {
                        for (const [key, value] of headers) {
                            xhr.setRequestHeader(key, value);
                        }
                    } else {
                        for (const [key, value] of Object.entries(headers)) {
                            xhr.setRequestHeader(key, String(value));
                        }
                    }
                }
                // 防死连接复用（回炉版 spec 第 1 节；llm-stream-native §7 条件化）：
                // 置于 headers 之后 = 覆盖用户 provider.headers 的同名头，强制
                // 生效。OkHttp 尊重请求侧 Connection: close（CallServerInterceptor →
                // noNewExchangesOnConnection），连接用完即废不回池——「上一次流留下的
                // （可能已静默死亡的）连接」不再被下一次请求复用。h2 下该头被协议剥离
                // （无害），黑洞由 xhr.timeout 兜底。
                // 条件化（spec §7）落地形态：native 分支不设 close 以保留连接复用，
                // 回落 XHR 才设。本分支只在 registered transport 缺席时执行，故此处
                // 无条件设置——native 注册态根本不进这里，等价于原
                // `!usedRegisteredTransport` 判断（该判断在此恒真，已按 core-transport Q2 简化掉）。
                xhr.setRequestHeader("Connection", "close");
                xhr.send(init.body ?? null);
            } else {
                /** fetch 分支：Desktop/CLI（流式 body 可用）与未注册 native 的非 RN 环境。 */
                const fetchFn = p.fetchFn ?? globalThis.fetch;

                // 组合自有 controller：用户 AbortSignal（停止生成）转发进来；公共层
                // 超时也经它主动断流。用户取消语义不变——signal abort →
                // controller.abort → fetch/reader 抛 AbortError → 上抛（与直接传
                // signal 等价）。
                const controller = new AbortController();
                if (signal != null) {
                    if (signal.aborted) {
                        controller.abort();
                    } else {
                        signal.addEventListener("abort", () => controller.abort(), { once: true });
                    }
                }
                ctx.abortStream = () => controller.abort();

                const dispatchState = SseDispatch.createState();

                // 整调用兜底（与 XHR 的 xhr.timeout 语义对齐，回炉版 spec 第 2 节）：
                // connect/写/读全周期预算，到点经公共层 handleWholeCallTimeout 分级收敛。
                ctx.wholeCallTimer = setTimeout(() => {
                    ctx.wholeCallTimer = null;
                    SsePostSettle.handleWholeCallTimeout(ctx, () => 0);
                }, SSE_WHOLE_CALL_TIMEOUT_MS);

                void (async () => {
                    try {
                        const response = await fetchFn(url, { ...init, signal: controller.signal });
                        const checked = await HttpUtil.assertOk(response, providerId);
                        if (!checked.ok) {
                            SsePostSettle.rejectOnce(ctx, reject, checked.error);
                            return;
                        }

                        if (response.body == null) {
                            const contentType = response.headers.get("content-type") ?? "none";
                            // SSE transport 的失败通道是 Promise reject（与文件内其余错误路径同款）：
                            // transport 边界不返 Result，AppError 经 rejectOnce 上行，由 adapter 收口。
                            const detail = `Empty streaming response body (HTTP ${response.status}, content-type: ${contentType}). This environment does not support fetch stream bodies.`;
                            SsePostSettle.rejectOnce(ctx, reject, new AppError("PROVIDER_HTTP_ERROR", { detail, providerId }));
                            return;
                        }

                        LlmSseTransport.logSse(logTag, "fetch stream start", {
                            status: response.status,
                            contentType: response.headers.get("content-type"),
                        });

                        const reader = response.body.getReader();
                        const decoder = new TextDecoder();

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                break;
                            }
                            // fetch 在此完成 UTF-8 解码，再经公共 dispatchChunk 直投
                            // onChunk（即时转发，无节流）；首包日志与 XHR 路径共用同一套
                            // 分发语义。noteActivity 只更新观测打点（lastActivityAt /
                            // processedLength），不参与任何超时判定（空闲看门狗已退役）。
                            const chunk = decoder.decode(value, { stream: true });
                            SsePostSettle.noteActivity(ctx, chunk.length);
                            SseDispatch.dispatchChunk(chunk, dispatchState, onChunk, (bytes) => LlmSseTransport.logSse(logTag, "fetch first chunk", { bytes }));
                        }

                        SsePostSettle.resolveOnce(ctx, resolve, {
                            status: response.status,
                            contentType: response.headers.get("content-type"),
                        });
                    } catch (error) {
                        if (ctx.settled) {
                            // 公共层已以超时错误 settle：controller.abort() 导致的 AbortError
                            // 在此丢弃，不让它顶替/竞态超时错误。
                            return;
                        }
                        SsePostSettle.rejectOnce(ctx, reject, error instanceof Error ? error : new Error(String(error)));
                    }
                })();
            }
        });
    },
} as const;
