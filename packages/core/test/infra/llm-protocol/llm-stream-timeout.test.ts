/**
 * LLM 流式黑洞根治——传输集成测试（spec llm-stream-timeout 回炉版 +
 * llm-stream-native 修订：空闲看门狗已退役，流式无固定空闲限制）：
 *
 * - T-D3/T-D4/T-D5（XHR）：Connection: close 头、xhr.timeout 整调用预算、
 *   ontimeout 分级（0 数据 → first-chunk 可重试；有数据 → idle 不重试）；
 * - 空闲超时退役（XHR 集成级）：长静默不自动超时；含超原阈值间隔的长流零误杀；
 * - T-D6（fetch）：whole-call 定时器同款分级；
 * - adapter 层：超时错误经 adapter rethrow，不吞成 partial；
 * - 观测：整调用超时打点字段按 spec 第 5 节口径可捕获并断言。
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
  SSE_WHOLE_CALL_TIMEOUT_MS,
} from "../../../src/infra/llm-protocol/logic/llm-sse-transport.js";
import { STREAM_IDLE_TIMEOUT_MS } from "../../../src/infra/llm-protocol/logic/stream-watchdog.js";
import { LlmStreamTimeoutError } from "../../../src/infra/llm-protocol/logic/llm-stream-timeout-error.js";
import { AnthropicProtocolAdapter } from "../../../src/infra/llm-protocol/impl/anthropic.adapter.js";

const SSE_URL = "https://api.example.com/v1/chat/completions";

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

describe("llm-stream-timeout XHR 集成（回炉版）", () => {
  it("T-D3: 请求带 Connection: close，且在用户头之后设置（覆盖 provider.headers 同名头）", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const promise = postSse(
      SSE_URL,
      {
        method: "POST",
        body: "{}",
        headers: {
          Authorization: "Bearer k",
          Connection: "keep-alive",
        },
      },
      () => {},
    );
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

  it("T-D4: xhr.timeout 被设为 SSE_WHOLE_CALL_TIMEOUT_MS（OkHttp callTimeout 兜底）", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();

    const xhr = instances[0]!;
    assert.equal(xhr.timeout, SSE_WHOLE_CALL_TIMEOUT_MS);
    assert.equal(xhr.ontimeout != null, true, "ontimeout 回调应已装配");

    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });

  it("T-D5: ontimeout 分级——0 数据（黑洞）→ reject LlmStreamTimeoutError('first-chunk')，非用户取消", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    let rejected = false;
    promise.catch(() => {
      rejected = true;
    });
    await settleAsync();

    // 无任何响应数据（黑洞形态），callTimeout 到点 RN dispatch timeout 事件
    instances[0]!.ontimeout?.();
    await settleAsync();

    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof LlmStreamTimeoutError);
      assert.equal(err.name, "LlmStreamTimeoutError");
      assert.equal(err.phase, "first-chunk");
      // 不得冒充用户取消（ProviderError "Request aborted"）
      assert.ok(!(err instanceof ProviderError));
      return true;
    });

    // 超时 settle 后，迟到的 load/abort 回调不得顶替超时错误
    const xhr = instances[0]!;
    xhr.status = 200;
    xhr.onload?.();
    assert.equal(rejected, true);
  });

  it("T-D5: ontimeout 分级——已有输出（健康长流超总预算）→ reject 'idle'（不自动重试语义）", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();

    const xhr = instances[0]!;
    xhr.responseText = 'data: {"x":1}\n\n';
    xhr.onprogress?.();
    await settleAsync();

    xhr.ontimeout?.();
    await assert.rejects(
      promise,
      (err: unknown) =>
        err instanceof LlmStreamTimeoutError && err.phase === "idle",
    );
  });

  it("B-1: 超时 settle 后迟到的 onprogress/onload 不得补投数据（settle 即终态）", async () => {
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
        err instanceof LlmStreamTimeoutError && err.phase === "first-chunk",
      "迟到 onload 不得把终态顶替成 resolve",
    );
  });

  it("B-1 姊妹：有数据 → idle 分级 settle 后，迟到回调不追加投递、不顶替终态", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(true);
    const instances = installXhr();

    const chunks: string[] = [];
    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      (chunk) => chunks.push(chunk),
    );
    let settledError: unknown;
    promise.catch((err: unknown) => {
      settledError = err;
    });
    await settleAsync();

    const xhr = instances[0]!;
    // 先有输出 → 整调用到点判 idle 分级（不自动重试）
    xhr.responseText = 'data: {"x":1}\n\n';
    xhr.onprogress?.();

    xhr.ontimeout?.();
    await settleAsync();
    assert.ok(
      settledError instanceof LlmStreamTimeoutError &&
        settledError.phase === "idle",
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
        err instanceof LlmStreamTimeoutError && err.phase === "idle",
      "迟到 onload 不得改变既有 idle 超时终态",
    );
  });

  it("空闲超时已退役——有 chunk 后长静默不自动超时，onload 正常收尾", async () => {
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
  it("T-D6: whole-call 兜底——body 无数据挂起 → reject LlmStreamTimeoutError('first-chunk') 而非 AbortError", async () => {
    mock.timers.enable();
    setShouldUseXhrForSseOverrideForTests(false);

    // start 不 enqueue 不 close：reader.read() 永久挂起（黑洞形态）
    const fetchFn = mock.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start() {
          // 模拟黑洞：无任何响应数据
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

    mock.timers.tick(SSE_WHOLE_CALL_TIMEOUT_MS);

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

  it("首帧后挂起——空闲超时退役后由整调用预算收敛（idle 分级，而非 AbortError）", async () => {
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
    // 让首帧 read() 返回
    await settleAsync();

    // 长静默远超原 idle 阈值：不得触发任何空闲自动超时
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS * 10);
    await settleAsync();

    // 整调用预算到点：按已有数据判 idle 分级（非 AbortError）
    mock.timers.tick(SSE_WHOLE_CALL_TIMEOUT_MS);

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

  it("adapter 层: 整调用预算超时经 anthropic adapter rethrow，不吞成 partial 正常完成", async () => {
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

    mock.timers.tick(SSE_WHOLE_CALL_TIMEOUT_MS);

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

describe("llm-stream-timeout 观测打点", () => {
  it("XHR: 整调用打点字段 phase/lastActivityAt/processedLength/bufferedBytes（bufferedBytes 取 emitter 待发缓冲）", async () => {
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

      // 整调用预算到点（XHR 分支经原生 xhr.timeout 回调；mock 下手动触发）
      xhr.ontimeout?.();

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

  it("fetch: 整调用打点 bufferedBytes 记 0，processedLength 为读循环内累计", async () => {
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

      // 整调用预算到点（fetch 分支经公共层 whole-call 定时器）
      mock.timers.tick(SSE_WHOLE_CALL_TIMEOUT_MS);

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
