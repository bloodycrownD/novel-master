/**
 * SseTransport port 三分支择优与 native 分支时序/错误映射测试
 * （spec llm-stream-native §3/§7；T-N2/T-N3）。
 *
 * - T-N3: 三分支逐请求择优 registered native > XHR > fetch；测试强制位
 *   `setSseTransportOverrideForTests`；`Connection: close` 条件化——native
 *   分支不设（init 原样透传），注销 native 回落 XHR 时保留。
 * - T-N2: transport 超时错误（native LlmSseError(kind:"timeout") 经 wrapper
 *   转换的两种契约形态）映射 `LlmStreamTimeoutError` 分级——0 数据 →
 *   first-chunk（可重试）；已投数据 → idle（不自动重试）。
 * - native 分支时序（公共层上移后与 XHR/fetch 同一套语义）：idle 看门狗、
 *   公共层超时经 opts.signal 断流、首字黑洞由 transport callTimeout 承接
 *   （JS 侧不开 whole-call 定时器）、用户取消 AbortError 原样上抛与
 *   isRequestAborted 判据链路兼容。
 *
 * @module test/infra/llm-protocol/llm-sse-transport-port
 */

import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import {
  postSse,
  registerSseTransport,
  resetShouldUseXhrForSseCacheForTests,
  setShouldUseXhrForSseOverrideForTests,
  setSseTransportOverrideForTests,
  SSE_WHOLE_CALL_TIMEOUT_MS,
  type SseByteHandler,
  type SseTransport,
} from "../../../src/infra/llm-protocol/logic/llm-sse-transport.js";
import { STREAM_IDLE_TIMEOUT_MS } from "../../../src/infra/llm-protocol/logic/stream-watchdog.js";
import { LlmStreamTimeoutError } from "../../../src/infra/llm-protocol/logic/llm-stream-timeout-error.js";
import { isRequestAborted } from "../../../src/infra/llm-protocol/logic/request-abort.js";

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

interface FakeTransportCall {
  url: string;
  init: RequestInit;
  opts?: { providerId?: string; signal?: AbortSignal; logTag?: string };
}

/**
 * 可手动驱动的假 transport：`post` 记录入参并挂起，测试侧经
 * emit/resolve/reject 驱动（native wrapper 的 requestId 匹配 + 事件回调
 * 形态由此收敛为最简）。
 */
function createHangingTransport(): {
  transport: SseTransport;
  calls: FakeTransportCall[];
  emit(text: string): void;
  resolve(value: { status: number; contentType: string | null }): void;
  reject(error: unknown): void;
} {
  const calls: FakeTransportCall[] = [];
  let onChunk: SseByteHandler | null = null;
  let settleResolve:
    | ((value: { status: number; contentType: string | null }) => void)
    | null = null;
  let settleReject: ((error: unknown) => void) | null = null;
  const transport: SseTransport = {
    post(url, init, chunkSink, opts) {
      calls.push({ url, init, opts });
      onChunk = chunkSink;
      return new Promise((resolve, reject) => {
        settleResolve = resolve;
        settleReject = reject;
      });
    },
  };
  return {
    transport,
    calls,
    emit: (text) => {
      onChunk?.(text);
    },
    resolve: (value) => {
      settleResolve?.(value);
    },
    reject: (error) => {
      settleReject?.(error);
    },
  };
}

/** 契约形态之一：name 标记的超时错误（wrapper 推荐）。 */
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

afterEach(() => {
  resetShouldUseXhrForSseCacheForTests();
  registerSseTransport(undefined);
  mock.timers.reset();
  uninstallXhr();
});

/** 等待微任务/nextTick 链排空（分支装配与 transport post 回调需要跑完）。 */
async function settleAsync(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.nextTick(() => {
      process.nextTick(resolve);
    });
  });
}

describe("T-N3: 三分支逐请求择优（registered native > XHR > fetch）", () => {
  it("native 注册时优先于 XHR：transport 被调用，XHR 构造器零实例化", async () => {
    const instances = installXhr();
    setShouldUseXhrForSseOverrideForTests(true);
    const fake = createHangingTransport();
    registerSseTransport(fake.transport);

    const chunks: string[] = [];
    const promise = postSse(
      SSE_URL,
      { method: "POST", headers: { Authorization: "Bearer k" }, body: "{}" },
      (chunk) => chunks.push(chunk),
    );
    await settleAsync();
    fake.emit('data: {"x":1}\n\n');
    fake.resolve({ status: 200, contentType: "text/event-stream" });

    const result = await promise;
    assert.equal(result.status, 200);
    assert.equal(chunks.join(""), 'data: {"x":1}\n\n');
    assert.equal(fake.calls.length, 1, "registered transport 承载请求");
    assert.equal(fake.calls[0]!.url, SSE_URL);
    assert.equal(
      instances.length,
      0,
      "registered native 优先于 XHR，XHR 不实例化",
    );
  });

  it("未注册时 RN 平台走 XHR 不走 fetchFn（XHR > fetch）", async () => {
    mock.timers.enable();
    const instances = installXhr();
    setShouldUseXhrForSseOverrideForTests(true);

    const fetchFn = mock.fn(async () => {
      throw new Error("fetch must not be called when XHR selected");
    });

    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      () => {},
      undefined,
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    await settleAsync();

    assert.equal(instances.length, 1, "未注册 native 时回落 XHR");
    assert.equal(fetchFn.mock.calls.length, 0);

    instances[0]!.status = 200;
    instances[0]!.onload?.();
    const result = await promise;
    assert.equal(result.status, 200);
  });

  it("未注册且非 RN 平台走 fetchFn（fetch 兜底，零变化）", async () => {
    setShouldUseXhrForSseOverrideForTests(false);

    const fetchFn = mock.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"x":1}\n\n'));
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    const result = await postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      () => {},
      undefined,
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    assert.equal(result.status, 200);
    assert.equal(fetchFn.mock.calls.length, 1, "fetch 兜底分支被选中");
  });

  it("测试强制位优先于真实注册位，清除后回到真实注册位", async () => {
    const real = createHangingTransport();
    const override = createHangingTransport();
    registerSseTransport(real.transport);

    setSseTransportOverrideForTests(override.transport);
    const first = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();
    override.resolve({ status: 200, contentType: "text/event-stream" });
    await first;
    assert.equal(override.calls.length, 1, "强制位生效");
    assert.equal(real.calls.length, 0, "真实注册位被强制位遮蔽");

    setSseTransportOverrideForTests(undefined);
    const second = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();
    real.resolve({ status: 200, contentType: "text/event-stream" });
    await second;
    assert.equal(real.calls.length, 1, "清除强制位后回到真实注册位");
  });
});

describe("T-N3: Connection: close 条件化（spec §7）", () => {
  it("native 分支请求头不含 Connection: close——init 原样透传，XHR 零实例化", async () => {
    const instances = installXhr();
    setShouldUseXhrForSseOverrideForTests(true);
    const fake = createHangingTransport();
    registerSseTransport(fake.transport);

    const promise = postSse(
      SSE_URL,
      {
        method: "POST",
        headers: { Authorization: "Bearer k" },
        body: "{}",
      },
      () => {},
    );
    await settleAsync();
    fake.resolve({ status: 200, contentType: "text/event-stream" });
    await promise;

    // init 原样透传给 transport：公共层不注入 Connection: close（native 管子
    // 自带读超时 + callTimeout，黑洞有界，保留连接复用）。
    assert.deepEqual(fake.calls[0]!.init.headers, {
      Authorization: "Bearer k",
    });
    assert.equal(
      instances.length,
      0,
      "close 头只存在于 XHR 分支的 setRequestHeader 路径",
    );
  });

  it("注销 native（模拟未注册/加载失败）回落 XHR 时 Connection: close 保留", async () => {
    mock.timers.enable();
    const instances = installXhr();
    setShouldUseXhrForSseOverrideForTests(true);
    const fake = createHangingTransport();
    // 先注册再注销：模拟「native 加载失败/运行中注销」的运行时回落路径。
    registerSseTransport(fake.transport);
    registerSseTransport(undefined);

    const promise = postSse(
      SSE_URL,
      {
        method: "POST",
        body: "{}",
        headers: { Authorization: "Bearer k", Connection: "keep-alive" },
      },
      () => {},
    );
    await settleAsync();

    assert.equal(fake.calls.length, 0, "注销后不再走 transport");
    const xhr = instances[0]!;
    const calls = xhr.setRequestHeader.mock.calls as Array<{
      arguments: [string, string];
    }>;
    const connCalls = calls.filter(
      (c) => c.arguments[0].toLowerCase() === "connection",
    );
    assert.equal(connCalls.length, 2, "用户头 + 传输层强制头各一次");
    assert.deepEqual(connCalls[0]!.arguments, ["Connection", "keep-alive"]);
    assert.deepEqual(
      connCalls[1]!.arguments,
      ["Connection", "close"],
      "回落 XHR 时保留 close（首字黑洞由 close + xhr.timeout 兜底，spec §7）",
    );

    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });
});

describe("T-N2: transport 超时错误映射 LlmStreamTimeoutError 分级", () => {
  it("0 数据超时（name 形态）→ 'first-chunk'（可重试分级），整调用预算", async () => {
    const fake = createHangingTransport();
    registerSseTransport(fake.transport);

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();

    // native callTimeout 到点：无任何 onChunk 投递（首字黑洞形态）
    fake.reject(nameTimeoutError());

    await assert.rejects(
      promise,
      (err: unknown) => {
        assert.ok(
          err instanceof LlmStreamTimeoutError,
          `应映射为 LlmStreamTimeoutError，实际：${String(err)}`,
        );
        assert.equal(err.name, "LlmStreamTimeoutError");
        assert.equal(err.phase, "first-chunk", "0 数据 → first-chunk 可重试");
        assert.match(
          err.message,
          new RegExp(String(SSE_WHOLE_CALL_TIMEOUT_MS)),
          "timeoutMs 取整调用预算",
        );
        assert.match(err.message, /native callTimeout/, "detail 标记来源");
        // 不冒充用户取消（isRequestAborted 三判据全不命中）
        assert.ok(!(err instanceof Error && err.name === "AbortError"));
        return true;
      },
    );
  });

  it("已投数据后超时（kind 字段形态）→ 'idle'（不自动重试分级）", async () => {
    const fake = createHangingTransport();
    registerSseTransport(fake.transport);

    const chunks: string[] = [];
    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      (chunk) => chunks.push(chunk),
    );
    await settleAsync();
    fake.emit('data: {"x":1}\n\n');
    fake.reject(kindTimeoutError());

    await assert.rejects(
      promise,
      (err: unknown) =>
        err instanceof LlmStreamTimeoutError && err.phase === "idle",
    );
    assert.equal(chunks.join(""), 'data: {"x":1}\n\n', "超时前数据已投递");
  });

  it("transport 普通错误原样上抛，不映射为超时", async () => {
    const fake = createHangingTransport();
    registerSseTransport(fake.transport);

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();
    fake.reject(new Error("boom: network down"));

    await assert.rejects(promise, (err: unknown) => {
      assert.ok(!(err instanceof LlmStreamTimeoutError));
      assert.ok(err instanceof Error);
      assert.equal((err as Error).message, "boom: network down");
      return true;
    });
  });
});

describe("native 分支时序（公共层上移后与 XHR/fetch 同一套语义）", () => {
  it("idle 看门狗：chunk 后静默到阈值 → 'idle' 超时 + 公共层经 opts.signal 断流", async () => {
    mock.timers.enable();
    const fake = createHangingTransport();
    registerSseTransport(fake.transport);

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    await settleAsync();

    fake.emit('data: {"x":1}\n\n');
    // 静默到 idle 阈值前一刻不触发
    mock.timers.tick(STREAM_IDLE_TIMEOUT_MS - 1);
    mock.timers.tick(1);

    await assert.rejects(
      promise,
      (err: unknown) =>
        err instanceof LlmStreamTimeoutError &&
        err.name === "LlmStreamTimeoutError" &&
        err.phase === "idle",
    );

    // 公共层超时断流钩子：传给 transport 的组合 signal 被 abort
    //（wrapper 侧据此转发原生 sseAbort）
    const opts = fake.calls[0]!.opts;
    assert.ok(opts?.signal != null, "port 收到组合 signal");
    assert.equal(
      opts.signal.aborted,
      true,
      "idle 超时 settle 后公共层经 opts.signal 主动断流",
    );
  });

  it("首字黑洞由 transport callTimeout 承接：JS 侧不开 whole-call 定时器", async () => {
    mock.timers.enable();
    const fake = createHangingTransport();
    registerSseTransport(fake.transport);

    const promise = postSse(SSE_URL, { method: "POST", body: "{}" }, () => {});
    let settledFlag = false;
    promise.then(
      () => {
        settledFlag = true;
      },
      () => {
        settledFlag = true;
      },
    );
    await settleAsync();

    // 推进超过整调用预算：native 分支不 arm JS 定时器（XHR 用 xhr.timeout、
    // native 用 transport 内 callTimeout），promise 必须仍 pending——首字
    // 黑洞的收敛来源是 transport 超时错误，而非公共层 JS 兜底。
    mock.timers.tick(SSE_WHOLE_CALL_TIMEOUT_MS + 1_000);
    assert.equal(settledFlag, false, "JS 侧 whole-call 定时器不应存在");

    // transport callTimeout 错误到达 → 公共层映射分级收敛
    fake.reject(nameTimeoutError());
    await assert.rejects(
      promise,
      (err: unknown) =>
        err instanceof LlmStreamTimeoutError &&
        err.phase === "first-chunk",
    );
  });

  it("用户取消：signal abort → transport AbortError 原样上抛，isRequestAborted 判据链路兼容", async () => {
    const userController = new AbortController();
    const fake: SseTransport = {
      post: (_url, _init, _onChunk, opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener(
            "abort",
            () => {
              // 模拟 wrapper：组合 signal abort → 原生断流 + AbortError 上抛
              const err = new Error("Request aborted");
              err.name = "AbortError";
              reject(err);
            },
            { once: true },
          );
        }),
    };
    registerSseTransport(fake);

    const promise = postSse(
      SSE_URL,
      { method: "POST", body: "{}" },
      () => {},
      "test-provider",
      { signal: userController.signal },
    );
    await settleAsync();
    userController.abort();

    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).name, "AbortError");
      // 与 ⑤ 现有 isRequestAborted 三判据链路保持兼容（signal.aborted 命中）
      assert.equal(isRequestAborted(err, userController.signal), true);
      return true;
    });
  });
});
