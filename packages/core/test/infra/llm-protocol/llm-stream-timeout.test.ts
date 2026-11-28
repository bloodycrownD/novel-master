/**
 * LLM 流式黑洞根治——传输集成测试（spec llm-stream-timeout 回炉版 +
 * llm-stream-native 修订：空闲看门狗与整调用预算均已退役，流式无任何自动超时）：
 *
 * - T-D3（XHR）：Connection: close 头在用户头之后设置（覆盖 provider.headers
 *   同名头）；
 * - 整调用预算退役（XHR 集成级）：不设 xhr.timeout；ontimeout 仅作防御装配，
 *   手动触发仍走分级（0 数据 → first-chunk 可重试；有数据 → idle 不自动重试），
 *   错误不再携带 timeoutMs，文案只描述现象与来源；
 * - 空闲超时退役（XHR 集成级）：长静默不自动超时；含超原阈值间隔的长流零误杀；
 * - 整调用预算退役（fetch 集成级）：无数据挂起 / 首帧后长静默，推进超原 600s
 *   假时钟 promise 仍 pending（不自动断开），随后正常收尾或由用户 abort 终止；
 * - adapter 层：transport 超时错误经 adapter rethrow，不吞成 partial 正常完成；
 * - 观测：超时打点字段（phase/source/lastActivityAt/processedLength/bufferedBytes）
 *   按 spec 第 5 节口径可捕获并断言（XHR 防御触发 / transport 超时错误触发）。
 *
 * @module test/infra/llm-protocol/llm-stream-timeout
 */

import assert from "node:assert/strict";
import {  describe, it, mock, afterEach  } from "node:test";
import {  AppErrorOps  } from "../../../src/errors/app-error.js";
import {  LlmSseTransport, type SseByteHandler, type SseTransport  } from "../../../src/infra/llm-protocol/logic/llm-sse-transport.js";
import {  STREAM_IDLE_TIMEOUT_MS  } from "../../../src/infra/llm-protocol/logic/stream-watchdog.js";
import {  AnthropicProtocolAdapter  } from "../../../src/infra/llm-protocol/impl/anthropic.adapter.js";
import {  LogFactory  } from "@novel-master/core/log";
import type { LogRecord } from "@novel-master/core/log";

const SSE_URL = "https://api.example.com/v1/chat/completions";

/** 原 SSE_WHOLE_CALL_TIMEOUT_MS 的数值（常量已随整调用预算删除）：仅作
 * 「推进超过原 600s 预算」的假时钟步进基准，不再断言任何行为绑定它。 */
const REMOVED_WHOLE_CALL_BUDGET_MS = 600_000;

/** Mock XHR：send 后挂起等待外部驱动（onprogress/onload/abort/ontimeout）。 */
class HangingXhr {
    open = mock.fn();
    setRequestHeader = mock.fn();
    abort = mock.fn(function (this: HangingXhr) {
        // 模拟真实 XHR：abort 同步回调 onabort
        this.onabort?.();
    });
    send = mock.fn(function (this: HangingXhr) {
        // 挂起：无任何响应，直到测试手动驱动或超时
    });
    onprogress: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    responseText = "";
    status = 0;
    timeout = 0;
    getResponseHeader = mock.fn(() => "text/event-stream");
}

function installXhr(): HangingXhr[] {
    const instances: HangingXhr[] = [];
    const Ctor = class extends HangingXhr {
        constructor() {
            super();
            instances.push(this);
        }
    };
    const origXhr = globalThis.XMLHttpRequest;
    (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = Ctor;
    (globalThis as { __origXhr?: unknown }).__origXhr = origXhr;
    return instances;
}

function uninstallXhr(): void {
    const g = globalThis as { XMLHttpRequest?: unknown; __origXhr?: unknown };
    if ("__origXhr" in g) {
        if (g.__origXhr === undefined) {
            delete g.XMLHttpRequest;
        } else {
            g.XMLHttpRequest = g.__origXhr;
        }
        delete g.__origXhr;
    }
}

afterEach(() => {
    LlmSseTransport.resetShouldUseXhrCacheForTests();
    LlmSseTransport.register(undefined);
    mock.timers.reset();
    uninstallXhr();
    const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean };
    delete g.__NM_DEBUG_LLM_FETCH__;
});

/** 等待微任务/nextTick 链排空（fetch 读循环的 noteActivity 需要跑完）。 */
async function settleAsync(): Promise<void> {
    await new Promise<void>((resolve) => {
        process.nextTick(() => {
            process.nextTick(resolve);
        });
    });
}

/** 契约形态之一：name 标记的超时错误（wrapper 推荐，对齐 native LlmSseTimeoutError）。 */
function nameTimeoutError(): Error {
    const err = new Error("LlmSseError: callTimeout elapsed");
    err.name = "LlmSseTimeoutError";
    return err;
}

/** 契约形态之二：携带 kind 字段的超时错误（对齐 native LlmSseError 事件面）。 */
function kindTimeoutError(): Error {
    return Object.assign(new Error("LlmSseError: read timeout"), {
        kind: "timeout",
    });
}

/** 可手动驱动的假 native transport：post 挂起，测试侧经 emit/reject 驱动。 */
function createHangingTransport(): {
    transport: SseTransport;
    emit(text: string): void;
    reject(error: unknown): void;
} {
    let onChunk: SseByteHandler | null = null;
    let settleReject: ((error: unknown) => void) | null = null;
    const transport: SseTransport = {
        post(_url, _init, chunkSink) {
            onChunk = chunkSink;
            return new Promise((_resolve, reject) => {
                settleReject = reject;
            });
        },
    };
    return {
        transport,
        emit: (text) => {
            onChunk?.(text);
        },
        reject: (error) => {
            settleReject?.(error);
        },
    };
}

describe("llm-stream-timeout XHR 集成（回炉版）", () => {
    it("T-D3: 请求带 Connection: close，且在用户头之后设置（覆盖 provider.headers 同名头）", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}", headers: { Authorization: "Bearer k", Connection: "keep-alive" } }, onChunk: () => {} });
        await settleAsync();

        const xhr = instances[0]!;
        const calls = xhr.setRequestHeader.mock.calls as Array<{
            arguments: [string, string];
        }>;
        const connCalls = calls.filter(
            (c) => c.arguments[0].toLowerCase() === "connection",
        );
        assert.equal(
            connCalls.length,
            2,
            "用户头 + 传输层强制头各一次",
        );
        assert.deepEqual(connCalls[0]!.arguments, ["Connection", "keep-alive"]);
        assert.deepEqual(
            connCalls[1]!.arguments,
            ["Connection", "close"],
            "传输层 Connection: close 必须在用户头之后（强制生效）",
        );

        // 清理：驱动 onload 正常收尾
        xhr.status = 200;
        xhr.onload?.();
        await promise;
    });

    it("T-D4 改版: 不设 xhr.timeout（流式无自动超时），ontimeout 仍装配作防御", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: () => {} });
        await settleAsync();

        const xhr = instances[0]!;
        assert.equal(
            xhr.timeout,
            0,
            "整调用预算已移除：不设 xhr.timeout（mock 初始值保持 0 = 不超时，挂死连接由用户手动终止）",
        );
        assert.equal(xhr.ontimeout != null, true, "ontimeout 回调应仍装配（防御：真派发也走公共层分级）");

        xhr.status = 200;
        xhr.onload?.();
        await promise;
    });

    it("T-D5（防御路径合并）: ontimeout 分级——0 数据 → first-chunk、有数据 → idle，错误无 timeoutMs、文案只描述现象", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        // 形态一：黑洞（无任何响应数据）——手动触发防御 ontimeout → first-chunk 可重试分级
        const firstPromise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: () => {} });
        firstPromise.catch(() => {});
        await settleAsync();

        instances[0]!.ontimeout?.();
        await settleAsync();

        await assert.rejects(firstPromise, (err: unknown) => {
            assert.ok(AppErrorOps.is(err, "PROVIDER_STREAM_TIMEOUT"));
            assert.equal(err.name, "PROVIDER_STREAM_TIMEOUT");
            assert.equal(err.details?.phase, "first-chunk");
            assert.equal(
                err.details?.timeoutMs,
                undefined,
                "整调用预算已移除：错误不再携带 timeoutMs",
            );
            assert.equal(
                err.message,
                "LLM stream timed out waiting for the first chunk (transport timeout)",
                "文案只描述现象与来源（budget = detail ?? transport timeout）",
            );
            // 不得冒充用户取消（PROVIDER_HTTP_ERROR "Request aborted" 形态）
            assert.ok(!AppErrorOps.is(err, "PROVIDER_HTTP_ERROR"));
            return true;
        });

        // 形态二：已有输出（健康长流）——同款防御触发 → idle 不自动重试分级
        //（mock.timers 全量启用下 emitter 的 32ms interval 不派发，数据留在
        // 待发缓冲；idle 分级本身即「已收到响应数据」的判据，交付断言由
        // 空闲退役用例的 onload flush 路径覆盖）
        const secondPromise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: () => {} });
        secondPromise.catch(() => {});
        await settleAsync();

        const xhr = instances[1]!;
        xhr.responseText = 'data: {"x":1}\n\n';
        xhr.onprogress?.();
        await settleAsync();

        xhr.ontimeout?.();
        await assert.rejects(secondPromise, (err: unknown) => {
            assert.ok(AppErrorOps.is(err, "PROVIDER_STREAM_TIMEOUT"));
            assert.equal(err.details?.phase, "idle");
            assert.equal(err.details?.timeoutMs, undefined);
            assert.equal(
                err.message,
                "LLM stream timed out after the last chunk (transport timeout)",
            );
            return true;
        });
    });

    it("B-1: 超时 settle 后迟到的 onprogress/onload 不得补投数据（settle 即终态）", async () => {
        // 触发方式：仍装配的防御 ontimeout（手动调用 mock 回调）。B-1 守卫的正是
        // XHR 回调面（onprogress/onload）与超时 settle 的竞态，ontimeout 是该
        // 竞态面的真实成员且可确定性触发，无需引入 native 假 transport。
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        const chunks: string[] = [];
        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: (chunk) => chunks.push(chunk) });
        let rejected = false;
        promise.catch(() => {
            rejected = true;
        });
        await settleAsync();

        // 0 数据黑洞形态：ontimeout 抢先 settle 为 first-chunk 超时
        const xhr = instances[0]!;
        xhr.ontimeout?.();
        await settleAsync();
        assert.equal(rejected, true, "超时先到并 settle");

        // settle 之后 RN 补发的迟到进度/完成回调：不得再投递任何数据
        xhr.responseText = 'data: {"late":1}\n\n';
        xhr.onprogress?.();
        xhr.status = 200;
        xhr.onload?.();
        await settleAsync();

        assert.equal(chunks.length, 0, "超时 settle 后不得投递迟到数据");
        await assert.rejects(
            promise,
            (err: unknown) =>
                AppErrorOps.is(err, "PROVIDER_STREAM_TIMEOUT") && err.details?.phase === "first-chunk",
            "迟到 onload 不得把终态顶替成 resolve",
        );
    });

    it("B-1 姊妹：有数据 → idle 分级 settle 后，迟到回调不追加投递、不顶替终态", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        const chunks: string[] = [];
        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: (chunk) => chunks.push(chunk) });
        let settledError: unknown;
        promise.catch((err: unknown) => {
            settledError = err;
        });
        await settleAsync();

        const xhr = instances[0]!;
        // 先有输出 → 防御 ontimeout 触发判 idle 分级（不自动重试）
        xhr.responseText = 'data: {"x":1}\n\n';
        xhr.onprogress?.();

        xhr.ontimeout?.();
        await settleAsync();
        assert.ok(
            AppErrorOps.is(settledError, "PROVIDER_STREAM_TIMEOUT") &&
                settledError.details?.phase === "idle",
            "有数据时按 idle 分级 settle",
        );

        // settle 后迟到回调：新数据不得追加投递，onload 不得改用 resolve 收尾
        xhr.responseText += 'data: {"x":2}\n\n';
        xhr.onprogress?.();
        xhr.status = 200;
        xhr.onload?.();
        await settleAsync();

        assert.ok(
            !chunks.join("").includes('"x":2'),
            "settle 后迟到的数据不得投递",
        );
        await assert.rejects(
            promise,
            (err: unknown) =>
                AppErrorOps.is(err, "PROVIDER_STREAM_TIMEOUT") && err.details?.phase === "idle",
            "迟到 onload 不得改变既有 idle 超时终态",
        );
    });

    it("空闲超时已退役——有 chunk 后长静默不自动超时，onload 正常收尾", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        const chunks: string[] = [];
        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: (chunk) => chunks.push(chunk) });
        let rejected = false;
        promise.catch(() => {
            rejected = true;
        });
        await settleAsync();

        const xhr = instances[0]!;
        // 首个 chunk 到达
        xhr.responseText = 'data: {"x":1}\n\n';
        xhr.onprogress?.();

        // 长静默：远超原 idle 阈值（产品拍板：流式不设固定空闲限制，
        // 合法停顿与死流无法区分）——不得触发任何自动超时。
        mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 10);
        await settleAsync();
        assert.equal(rejected, false, "流中长静默不应触发空闲超时");

        // 数据恢复到达 + 正常收尾
        xhr.responseText += 'data: {"x":2}\n\n';
        xhr.onprogress?.();
        xhr.status = 200;
        xhr.onload?.();

        const result = await promise;
        assert.equal(result.status, 200);
        assert.ok(
            chunks.join("").includes('"x":2'),
            "静默前后数据均应完整交付",
        );
    });

    it("零误杀——含超原阈值静默间隔的长流正常收尾", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        const chunks: string[] = [];
        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: (chunk) => chunks.push(chunk) });
        await settleAsync();

        const xhr = instances[0]!;
        // 慢节奏 chunk（间隔 45s，超过原 30s 阈值），持续 9 分钟的长流
        xhr.responseText = 'data: {"x":0}\n\n';
        xhr.onprogress?.();
        for (let i = 1; i <= 12; i++) {
            mock.timers.tick(45_000);
            xhr.responseText += `data: {"x":${i}}\n\n`;
            xhr.onprogress?.();
        }
        // 正常收尾
        mock.timers.tick(45_000);
        xhr.status = 200;
        xhr.onload?.();

        const result = await promise;
        assert.equal(result.status, 200);
        assert.ok(
            chunks.join("").includes('"x":12'),
            "正常收尾应完整交付（onload flush 兜底）",
        );

        // 收尾后再推进时间：promise 状态不再变化（幂等，无残留定时器副作用）
        mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 4);
        await promise;
    });
});

describe("llm-stream-timeout fetch 集成（回炉版）", () => {
    it("整调用预算退役: body 无数据长时间挂起不被自动断开——超原 600s 仍 pending，随后正常收尾", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(false);

        // start 不 enqueue 不 close：reader.read() 永久挂起（黑洞形态）；
        // 保留 close 句柄供测试侧在「无自动断开」得证后正常收尾。
        const bodyControl = { close: (): void => {} };
        const fetchFn = mock.fn(async (): Promise<Response> => {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    // 模拟黑洞：无任何响应数据
                    bodyControl.close = () => controller.close();
                },
            });
            return new Response(body, {
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
            });
        });

        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: () => {}, fetchFn: fetchFn as typeof fetch });
        let settled = false;
        promise.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );
        await settleAsync();

        // 推进超过原整调用预算（600s）+ 原空闲阈值：不得自动断开，promise 保持 pending
        mock.timers.tick(REMOVED_WHOLE_CALL_BUDGET_MS + STREAM_IDLE_TIMEOUT_MS * 10);
        await settleAsync();
        assert.equal(settled, false, "流式无任何自动超时：无数据挂起不得被自动断开");

        // 数据侧正常收尾（空流 close）：promise 正常兑现
        bodyControl.close();
        const result = await promise;
        assert.equal(result.status, 200);
    });

    it("整调用预算退役: 首帧后长时间静默不被自动断开——超原 600s 仍 pending，由用户 abort 终止", async () => {
        mock.timers.enable();
        LlmSseTransport.setShouldUseXhrOverrideForTests(false);

        const fetchFn = mock.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(
                        new TextEncoder().encode('data: {"x":1}\n\n'),
                    );
                    // 不 close：首帧到达后 provider 停流。模拟真实 fetch 的
                    // abort 契约：signal abort → 在途 read 以 AbortError 拒绝。
                    init?.signal?.addEventListener(
                        "abort",
                        () => {
                            const err = new Error("The operation was aborted");
                            err.name = "AbortError";
                            controller.error(err);
                        },
                        { once: true },
                    );
                },
            });
            return new Response(body, {
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
            });
        });

        const user = new AbortController();
        const chunks: string[] = [];
        const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: (chunk) => chunks.push(chunk), fetchFn: fetchFn as typeof fetch, signal: user.signal });
        let settled = false;
        promise.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );
        await settleAsync();
        assert.ok(chunks.join("").includes('"x":1'), "首帧正常投递");

        // 长静默远超原 idle 阈值与原整调用预算：不得触发任何自动超时/断流
        mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 10 + REMOVED_WHOLE_CALL_BUDGET_MS);
        await settleAsync();
        assert.equal(settled, false, "首帧后静默不得自动断开（空闲与整调用预算均已退役）");

        // 挂死的连接由用户手动终止：AbortError 原样上抛
        user.abort();
        await assert.rejects(promise, (err: unknown) => err instanceof Error && err.name === "AbortError");
    });

    it("adapter 层: transport 超时错误经 anthropic adapter rethrow，不吞成 partial 正常完成", async () => {
        // 触发方式：注册 native transport 抛超时错误（旧版安装包 Kotlin 默认
        // 600s 的契约形态）。fetch 分支已无任何超时触发源（整调用预算退役），
        // 而注册 transport 优先于 fetchFn，adapter 的流式路径恰好由此穿过
        // LlmSseTransport.post 的公共层超时映射——「adapter 不吞超时」的意图不丢。
        LlmSseTransport.setShouldUseXhrOverrideForTests(false);
        const fake = createHangingTransport();
        LlmSseTransport.register(fake.transport);

        const fetchFn = mock.fn(async (): Promise<Response> => {
            throw new Error("fetch must not be called when native transport registered");
        });

        const adapter = new AnthropicProtocolAdapter(fetchFn as typeof fetch);
        const chatPromise = adapter.chat({
            baseUrl: "https://api.anthropic.com",
            apiKey: "key",
            vendorModelId: "claude",
            userContent: "hi",
            stream: true,
        });
        await settleAsync();

        // 首帧正常投递后 transport 抛超时错误 → 公共层按已有数据判 idle 分级
        fake.emit('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Par"}}\n\n');
        await settleAsync();
        fake.reject(nameTimeoutError());

        // isRequestAborted 对超时错误三条件全不命中 → adapter catch 走 rethrow，
        // 不会返回 partial blocks 正常完成
        await assert.rejects(
            chatPromise,
            (err: unknown) => {
                assert.ok(
                    AppErrorOps.is(err, "PROVIDER_STREAM_TIMEOUT"),
                    `应 rethrow 超时错误，实际：${String(err)}`,
                );
                assert.equal(err.details?.phase, "idle");
                assert.equal(err.details?.timeoutMs, undefined);
                return true;
            },
        );
    });
});

describe("llm-stream-timeout 观测打点", () => {
    it("XHR: 防御超时打点字段 phase/source/lastActivityAt/processedLength/bufferedBytes（bufferedBytes 取 emitter 待发缓冲）", async () => {
        // 只 mock setTimeout：emitter 的 setInterval 保持真实——测试毫秒级完成，
        // 待发缓冲不会被 32ms tick 冲走，bufferedBytes 才能按观测口径断言堆积
        mock.timers.enable({ apis: ["setTimeout"] });
        LlmSseTransport.setShouldUseXhrOverrideForTests(true);
        const instances = installXhr();

        const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean };
        g.__NM_DEBUG_LLM_FETCH__ = true;
        const records: LogRecord[] = [];
        LogFactory.setDefaultSink({ write: (record) => records.push(record) });

        try {
            const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: () => {} });
            await settleAsync();

            const xhr = instances[0]!;
            // 100 字符数据到达：processedLength 记已消费长度，append 进 emitter 缓冲
            // （真实 interval 未到 32ms，buffer 保留）
            xhr.responseText = "x".repeat(100);
            xhr.onprogress?.();

            // 防御 ontimeout（未设超时本不会派发；mock 下手动触发）
            xhr.ontimeout?.();

            await assert.rejects(
                promise,
                (err: unknown) => AppErrorOps.is(err, "PROVIDER_STREAM_TIMEOUT"),
            );

            const timeoutCall = records.find(
                (record) => record.message === "stream timeout",
            );
            assert.ok(timeoutCall != null, "应有 stream timeout 打点日志");
            const detail = timeoutCall.detail as unknown as {
                phase: string;
                source: string;
                lastActivityAt: number;
                processedLength: number;
                bufferedBytes: number;
            };
            assert.equal(detail.phase, "idle");
            assert.equal(
                detail.source,
                "transport",
                "XHR 防御触发无 detail，source 记 transport",
            );
            assert.equal(
                typeof detail.lastActivityAt,
                "number",
                "lastActivityAt 应为时间戳数字",
            );
            assert.ok(detail.lastActivityAt > 0);
            assert.equal(
                detail.processedLength,
                100,
                "processedLength 取 postSseViaXhr 现成已消费长度变量",
            );
            assert.equal(
                detail.bufferedBytes,
                100,
                "bufferedBytes 取 SSE emitter 待发缓冲长度",
            );
        } finally {
            LogFactory.restoreDefaultSink();
        }
    });

    it("transport 超时错误触发打点: processedLength 记投递累计，bufferedBytes 记 0（即时转发无节流缓冲）", async () => {
        // fetch 分支已无任何超时触发源（整调用预算退役），观测口径改由
        // native transport 超时错误触发验证：即时转发路径（native/fetch 同款）
        // processedLength 为投递累计、bufferedBytes 恒 0。
        LlmSseTransport.setShouldUseXhrOverrideForTests(false);
        const fake = createHangingTransport();
        LlmSseTransport.register(fake.transport);

        const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean };
        g.__NM_DEBUG_LLM_FETCH__ = true;
        const records: LogRecord[] = [];
        LogFactory.setDefaultSink({ write: (record) => records.push(record) });

        try {
            const promise = LlmSseTransport.post({ url: SSE_URL, init: { method: "POST", body: "{}" }, onChunk: () => {} });
            await settleAsync();

            fake.emit("abc");
            await settleAsync();
            // transport 抛超时错误（kind 契约形态）→ 公共层映射分级并打点
            fake.reject(kindTimeoutError());

            await assert.rejects(
                promise,
                (err: unknown) => AppErrorOps.is(err, "PROVIDER_STREAM_TIMEOUT"),
            );

            const timeoutCall = records.find(
                (record) => record.message === "stream timeout",
            );
            assert.ok(timeoutCall != null, "应有 stream timeout 打点日志");
            const detail = timeoutCall.detail as unknown as {
                phase: string;
                source: string;
                lastActivityAt: number;
                processedLength: number;
                bufferedBytes: number;
            };
            assert.equal(detail.phase, "idle");
            assert.equal(
                detail.source,
                "native timeout: LlmSseError: read timeout",
                "source 透传 transport 超时错误的真实信息",
            );
            assert.equal(
                typeof detail.lastActivityAt,
                "number",
                "lastActivityAt 应为时间戳数字",
            );
            assert.ok(detail.lastActivityAt > 0);
            assert.equal(
                detail.processedLength,
                3,
                "processedLength 为投递累计字符数（即时转发路径）",
            );
            assert.equal(
                detail.bufferedBytes,
                0,
                "即时转发无节流缓冲，bufferedBytes 记 0",
            );
        } finally {
            LogFactory.restoreDefaultSink();
        }
    });
});
