/**
 * LLM 流式超时兜底——传输集成测试（spec llm-stream-timeout）：
 *
 * - T-T1/T-T2/T-T3（XHR 集成级）：首字超时 / 空闲超时 / 慢节奏零误杀；
 * - T-T7（fetch）：读循环同款双超时，reject LlmStreamTimeoutError 而非 AbortError；
 * - T-T5 前半（adapter 层）：idle 超时错误经 adapter rethrow，不吞成 partial；
 * - T-T9（观测）：onTimeout 打点字段按 spec 第 5 节口径可捕获并断言。
 *
 * @module test/infra/llm-protocol/llm-stream-timeout
 */

import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import { ProviderError } from "../../../src/errors/provider-errors.js";
import {
  postSse,
  resetShouldUseXhrForSseCacheForTests,
  setShouldUseXhrForSseOverrideForTests,
} from "../../../src/infra/llm-protocol/logic/llm-sse-transport.js";
import {
  FIRST_CHUNK_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
} from "../../../src/infra/llm-protocol/logic/stream-watchdog.js";
import { LlmStreamTimeoutError } from "../../../src/infra/llm-protocol/logic/llm-stream-timeout-error.js";
import { AnthropicProtocolAdapter } from "../../../src/infra/llm-protocol/impl/anthropic.adapter.js";

const SSE_URL = "https://api.example.com/v1/chat/completions";

/** Mock XHR：send 后挂起等待外部驱动（onprogress/onload/abort）。 */
class HangingXhr {
  open = mock.fn();
  setRequestHeader = mock.fn();
  abort = mock.fn(function (this: HangingXhr) {
    // 模拟真实 XHR：abort 同步回调 onabort
    this.onabort?.();
  });
  send = mock.fn(function (this: HangingXhr) {
    // 挂起：无任何响应，直到测试手动驱动或 watchdog 触发 abort
  });
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  responseText = "";
  status = 0;
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
  resetShouldUseXhrForSseCacheForTests();
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

describe("llm-stream-timeout XHR 集成", () => {
  it("T-T1: 首字超时——无 onprogress 到阈值 → reject LlmStreamTimeoutError('first-chunk')，非 Request aborted，abort 仅作清理", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();

    // 到点触发：先 rejectOnce(超时错误) 抢占 settle，再 xhr.abort() 断流清理
    mock.timers.tick(FIRST_CHUNK_TIMEOUT_MS);

    await assert.rejects(
      promise,
      (err: unknown) => {
        assert.ok(err instanceof LlmStreamTimeoutError);
        assert.equal(err.name, "LlmStreamTimeoutError");
        assert.equal(err.phase, "first-chunk");
        // 不得冒充用户取消（ProviderError "Request aborted"）
        assert.ok(!(err instanceof ProviderError));
        return true;
      },
    );

    // abort 随后仅作断流清理：同步触发 onabort，其 rejectOnce 被 settled 守卫
    // 挡掉，最终上抛的仍是超时错误（上面已断言类型）
    const xhr = instances[0]!;
    assert.equal(xhr.abort.mock.calls.length, 1);
    assert.equal(xhr.onabort != null, true);
  });

  it("T-T2: 空闲超时——有 chunk 后静默到阈值 → reject LlmStreamTimeoutError('idle')；chunk 持续到达不触发", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const chunks: string[] = [];
    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      (chunk) => chunks.push(chunk),
    );
    let rejected = false;
    promise.catch(() => {
      rejected = true;
    });
    await settleAsync();

    const xhr = instances[0]!;
    // 首个 chunk 到达（首字阶段撤销）
    xhr.responseText = 'data: {"x":1}\n\n';
    xhr.onprogress?.();

    // 静默到 idle 阈值前一刻不触发
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS - 1);
    // chunk 持续到达重置空闲计时：慢节奏（间隔 < idle 阈值）推进 5 分钟不触发
    for (let i = 0; i < 3; i++) {
      xhr.responseText += `data: {"x":${i + 2}}\n\n`;
      xhr.onprogress?.();
      mock.timers.tick(60_000);
    }
    // flush 微任务后确认慢节奏推进期间未被 reject
    await settleAsync();
    assert.equal(rejected, false, "慢节奏推进期间不应提前 reject");

    // 静默到 idle 到点触发
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS);
    await assert.rejects(
      promise,
      (err: unknown) =>
        err instanceof LlmStreamTimeoutError && err.phase === "idle",
    );
  });

  it("T-T3: 零误杀——慢节奏长流正常 onload 收尾；dispose 后定时器清空", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const chunks: string[] = [];
    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      (chunk) => chunks.push(chunk),
    );
    await settleAsync();

    const xhr = instances[0]!;
    // 慢节奏 chunk（间隔 60s < 90s），持续 8 分钟的长流
    xhr.responseText = 'data: {"x":0}\n\n';
    xhr.onprogress?.();
    for (let i = 1; i <= 8; i++) {
      mock.timers.tick(60_000);
      xhr.responseText += `data: {"x":${i}}\n\n`;
      xhr.onprogress?.();
    }
    // 正常收尾
    mock.timers.tick(60_000);
    xhr.status = 200;
    xhr.onload?.();

    const result = await promise;
    assert.equal(result.status, 200);
    assert.ok(
      chunks.join("").includes('"x":8'),
      "正常收尾应完整交付（onload flush 兜底）",
    );

    // dispose 后定时器清空：再推进远超两阈值的时长，无任何后续 reject/回调
    await promise; // 已 fulfilled，确认不再变
    mock.timers.tick(FIRST_CHUNK_TIMEOUT_MS + STREAM_IDLE_TIMEOUT_MS);
    await promise;
  });
});

describe("llm-stream-timeout fetch 集成", () => {
  it("T-T7: 首字超时——body 无数据挂起 → reject LlmStreamTimeoutError('first-chunk') 而非 AbortError", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(false);

    // start 不 enqueue 不 close：reader.read() 永久挂起（真实挂死形态）
    const fetchFn = mock.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start() {
          // 模拟网关排队/上游建连静默
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      () => {},
      undefined,
      { fetchFn: fetchFn as typeof fetch },
    );
    await settleAsync();

    mock.timers.tick(FIRST_CHUNK_TIMEOUT_MS);

    await assert.rejects(
      promise,
      (err: unknown) => {
        assert.ok(err instanceof LlmStreamTimeoutError);
        assert.equal(err.phase, "first-chunk");
        assert.notEqual((err as Error).name, "AbortError");
        return true;
      },
    );
  });

  it("T-T7: 空闲超时——首帧后挂起 → reject LlmStreamTimeoutError('idle') 而非 AbortError", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(false);

    const fetchFn = mock.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"x":1}\n\n'),
          );
          // 不 close：首帧到达后 provider 停流
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      () => {},
      undefined,
      { fetchFn: fetchFn as typeof fetch },
    );
    // 让首帧 read() 返回（noteActivity 撤销首字阶段）
    await settleAsync();

    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS);

    await assert.rejects(
      promise,
      (err: unknown) => {
        assert.ok(err instanceof LlmStreamTimeoutError);
        assert.equal(err.phase, "idle");
        assert.notEqual((err as Error).name, "AbortError");
        return true;
      },
    );
  });

  it("T-T5 前半（adapter 层）: idle 超时经 anthropic adapter rethrow，不吞成 partial 正常完成", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(false);

    const fetchFn = mock.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Par"}}\n\n',
            ),
          );
          // 首帧后停流
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
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

    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS);

    // isRequestAborted 对超时错误三条件全不命中 → adapter catch 走 rethrow，
    // 不会返回 partial blocks 正常完成
    await assert.rejects(
      chatPromise,
      (err: unknown) => {
        assert.ok(
          err instanceof LlmStreamTimeoutError,
          `应 rethrow 超时错误，实际：${String(err)}`,
        );
        assert.equal(err.phase, "idle");
        return true;
      },
    );
  });
});

describe("llm-stream-timeout 观测打点 T-T9", () => {
  it("XHR: onTimeout 打点字段 phase/lastActivityAt/processedLength/bufferedBytes（bufferedBytes 取 emitter 待发缓冲）", async () => {
    // 只 mock setTimeout：emitter 的 setInterval 保持真实——测试毫秒级完成，
    // 待发缓冲不会被 32ms tick 冲走，bufferedBytes 才能按观测口径断言堆积
    mock.timers.enable({ apis: ["setTimeout"] });
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean };
    g.__NM_DEBUG_LLM_FETCH__ = true;
    const logMock = mock.method(console, "log", () => {});

    try {
      const promise = postSse(
        SSE_URL,
        { method: "POST", body: "{}" },
        () => {},
      );
      await settleAsync();

      const xhr = instances[0]!;
      // 100 字符数据到达：processedLength 记已消费长度，append 进 emitter 缓冲
      // （真实 interval 未到 32ms，buffer 保留）
      xhr.responseText = "x".repeat(100);
      xhr.onprogress?.();

      mock.timers.tick(STREAM_IDLE_TIMEOUT_MS);

      await assert.rejects(
        promise,
        (err: unknown) => err instanceof LlmStreamTimeoutError,
      );

      const timeoutCall = logMock.mock.calls.find(
        (call) => call.arguments[1] === "stream timeout",
      );
      assert.ok(timeoutCall != null, "应有 stream timeout 打点日志");
      const detail = timeoutCall.arguments[2] as {
        phase: string;
        lastActivityAt: number;
        processedLength: number;
        bufferedBytes: number;
      };
      assert.equal(detail.phase, "idle");
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
      logMock.mock.restore();
    }
  });

  it("fetch: onTimeout 打点 bufferedBytes 记 0，processedLength 为读循环内累计", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(false);

    const g = globalThis as { __NM_DEBUG_LLM_FETCH__?: boolean };
    g.__NM_DEBUG_LLM_FETCH__ = true;
    const logMock = mock.method(console, "log", () => {});

    try {
      const fetchFn = mock.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("abc"));
            // 首帧后停流
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      });

      const promise = postSse(
        SSE_URL,
        { method: "POST", body: "{}" },
        () => {},
        undefined,
        { fetchFn: fetchFn as typeof fetch },
      );
      await settleAsync();

      mock.timers.tick(STREAM_IDLE_TIMEOUT_MS);

      await assert.rejects(
        promise,
        (err: unknown) => err instanceof LlmStreamTimeoutError,
      );

      const timeoutCall = logMock.mock.calls.find(
        (call) => call.arguments[1] === "stream timeout",
      );
      assert.ok(timeoutCall != null, "应有 stream timeout 打点日志");
      const detail = timeoutCall.arguments[2] as {
        phase: string;
        lastActivityAt: number;
        processedLength: number;
        bufferedBytes: number;
      };
      assert.equal(detail.phase, "idle");
      assert.equal(
        detail.processedLength,
        3,
        "fetch 的 processedLength 为 decoder.decode 后累计字符数",
      );
      assert.equal(
        detail.bufferedBytes,
        0,
        "fetch 路径即时转发无节流缓冲，bufferedBytes 记 0",
      );
    } finally {
      logMock.mock.restore();
    }
  });
});
