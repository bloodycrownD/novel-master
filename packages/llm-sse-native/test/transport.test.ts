/**
 * T-N1：wrapper 传输链路（spec llm-stream-native 测试策略）。
 *
 * mock bridge 高速注入 LlmSseChunk 事件，断言 requestId 匹配、事件 1:1 透传
 * （无丢失/重复/放大）、LlmSseError → transport 错误映射；含 requestId 实例
 * 前缀（跨模块重载不撞 id）与 core 下发整调用预算（wholeCallTimeoutMs）透传。
 * native 合批精度（100ms/64K 字符、事件率）不在此断言——归 Step 7/8 manual。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NativeSseAbortError,
  NativeSseTransportError,
  createNativeSseTransportFromBridge,
  flattenRequestHeaders,
} from "../src/transport.js";
import {
  LLM_SSE_EVENT_CHUNK,
  LLM_SSE_EVENT_DONE,
  LLM_SSE_EVENT_ERROR,
  LLM_SSE_EVENT_HEADERS,
} from "../src/types.js";
import { createMockBridge } from "./mock-bridge.js";

/** 一次完整的成功流：headers → chunks → done。返回 promise 与注入工具。 */
function startStream(mock: ReturnType<typeof createMockBridge>) {
  const chunks: string[] = [];
  const promise = createNativeSseTransportFromBridge(mock.bridge).post(
    "https://example.test/v1/chat",
    { method: "POST", body: '{"prompt":"hi"}' },
    (chunk) => {
      chunks.push(chunk);
    },
  );
  const requestId = mock.connects[0]?.requestId;
  assert.ok(requestId != null, "sseConnect 应已被调用");
  return { promise, chunks, requestId: requestId as string };
}

describe("createNativeSseTransportFromBridge（T-N1）", () => {
  it("全链路：headers 记录 status/contentType，chunk 1:1 透传，done 后 resolve", async () => {
    const mock = createMockBridge();
    const { promise, chunks, requestId } = startStream(mock);

    mock.emit(LLM_SSE_EVENT_HEADERS, {
      requestId,
      status: 200,
      contentType: "text/event-stream",
    });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "data: {\"a\":1}\n\n" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "data: {\"b\":2}\n\n" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });

    const result = await promise;
    assert.equal(result.status, 200);
    assert.equal(result.contentType, "text/event-stream");
    assert.deepEqual(chunks, [
      'data: {"a":1}\n\n',
      'data: {"b":2}\n\n',
    ]);
  });

  it("高速注入 1000 个 chunk：无丢失、无重复、无放大", async () => {
    const mock = createMockBridge();
    const { promise, chunks, requestId } = startStream(mock);

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: "text/event-stream" });
    const expected: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const text = `data: {"i":${i}}\n\n`;
      expected.push(text);
      mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text });
    }
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });

    await promise;
    assert.equal(chunks.length, 1000);
    assert.deepEqual(chunks, expected);
  });

  it("requestId 匹配：其它请求的事件不串流", async () => {
    const mock = createMockBridge();
    const { promise, chunks, requestId } = startStream(mock);

    // 同一事件总线上混入别的 requestId（并发流）
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: "other-1", status: 500, contentType: null });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: "other-1", text: "别人的数据" });
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: "text/event-stream" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "自己的数据" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: "other-1" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });

    const result = await promise;
    assert.equal(result.status, 200);
    assert.deepEqual(chunks, ["自己的数据"]);
  });

  it("并发两个请求：各自路由正确、requestId 前缀区分", async () => {
    const mock = createMockBridge();
    const transport = createNativeSseTransportFromBridge(mock.bridge);
    const chunksA: string[] = [];
    const chunksB: string[] = [];

    const promiseA = transport.post("https://a.test", { method: "POST", body: "a" }, (c) => chunksA.push(c));
    const promiseB = transport.post("https://b.test", { method: "POST", body: "b" }, (c) => chunksB.push(c));

    assert.equal(mock.connects.length, 2);
    const [idA, idB] = mock.connects.map((c) => c.requestId);
    assert.notEqual(idA, idB);
    // 一次性实例前缀（6 位 base36）+ 递增序号
    assert.match(idA, /^llm-sse-[0-9a-z]{6}-\d+$/);
    assert.match(idB, /^llm-sse-[0-9a-z]{6}-\d+$/);

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: idA, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: idB, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: idB, text: "B1" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: idA, text: "A1" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: idB, text: "B2" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: idB });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: idA, text: "A2" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: idA });

    assert.deepEqual(chunksA, ["A1", "A2"]);
    assert.deepEqual(chunksB, ["B1", "B2"]);
    assert.deepEqual(await promiseA, { status: 200, contentType: null });
    assert.deepEqual(await promiseB, { status: 200, contentType: null });
  });

  it("模块重载：第二份模块实例共用同一 native 总线也不撞 id（一次性实例前缀）", async () => {
    const mock = createMockBridge();
    // import query 绕过 ESM 模块缓存 → 第二份模块实例 ≈ JS 热重载（计数器复位）
    const reloaded = (await import(
      `../src/transport.js?reload=${Date.now()}`
    )) as {
      createNativeSseTransportFromBridge: typeof createNativeSseTransportFromBridge;
    };

    const chunksBefore: string[] = [];
    const chunksAfter: string[] = [];
    // 同一 mock bridge = 同一 native 模块：重载前后的旧 id 仍存活于 native 侧
    const promiseBefore = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://before.test",
      { method: "POST", body: "" },
      (c) => chunksBefore.push(c),
    );
    const promiseAfter = reloaded.createNativeSseTransportFromBridge(mock.bridge).post(
      "https://after.test",
      { method: "POST", body: "" },
      (c) => chunksAfter.push(c),
    );

    assert.equal(mock.connects.length, 2);
    const [idBefore, idAfter] = mock.connects.map((c) => c.requestId);
    // 两份实例的计数器都从 1 重来：id 必须靠前缀隔开（旧实现此处会重复）
    const prefixOf = (requestId: string): string => requestId.split("-")[2] ?? "";
    assert.match(idBefore, /^llm-sse-[0-9a-z]{6}-\d+$/);
    assert.match(idAfter, /^llm-sse-[0-9a-z]{6}-\d+$/);
    assert.notEqual(idBefore, idAfter);
    assert.notEqual(prefixOf(idBefore), prefixOf(idAfter));

    // 两套 id 空间互不串流、各自正常收尾
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: idBefore, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: idAfter, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: idAfter, text: "after" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: idBefore, text: "before" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: idBefore });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: idAfter });

    assert.deepEqual(chunksBefore, ["before"]);
    assert.deepEqual(chunksAfter, ["after"]);
    assert.deepEqual(await promiseBefore, { status: 200, contentType: null });
    assert.deepEqual(await promiseAfter, { status: 200, contentType: null });
  });

  it("settle 后到达的迟到事件被丢弃（不重复 onChunk、不二次 settle）", async () => {
    const mock = createMockBridge();
    const { promise, chunks, requestId } = startStream(mock);

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "ok" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });
    await promise;

    // Done 之后 native 不应再发（合批余量 flush 已在 native 侧先行），若发了也须被忽略
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "late" });
    mock.emit(LLM_SSE_EVENT_ERROR, { requestId, kind: "network", message: "late" });
    assert.deepEqual(chunks, ["ok"]);
  });

  it("形状不合法的事件载荷被忽略（宽容解析）", async () => {
    const mock = createMockBridge();
    const { promise, chunks, requestId } = startStream(mock);

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: "text/event-stream" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId: 123, text: "x" }); // requestId 非字符串
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId }); // 缺 text
    mock.emit(LLM_SSE_EVENT_CHUNK, null); // 非对象
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "valid" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });

    await promise;
    assert.deepEqual(chunks, ["valid"]);
  });

  it("sseConnect 参数透传：headers 扁平化、body、超时默认 -1", async () => {
    const mock = createMockBridge();
    const { promise, requestId } = (() => {
      const chunks: string[] = [];
      const promise = createNativeSseTransportFromBridge(mock.bridge).post(
        "https://example.test/stream",
        {
          method: "POST",
          headers: { Authorization: "Bearer tk", "Content-Type": "application/json" },
          body: '{"x":1}',
        },
        (c) => chunks.push(c),
      );
      const requestId = mock.connects[0]?.requestId ?? "";
      return { promise, requestId };
    })();

    const connect = mock.connects[0];
    assert.ok(connect != null);
    assert.equal(connect.url, "https://example.test/stream");
    assert.deepEqual(connect.headersKv, ["Authorization", "Bearer tk", "Content-Type", "application/json"]);
    assert.equal(connect.body, '{"x":1}');
    assert.equal(connect.readTimeoutMs, -1); // readMs 已退役（恒禁用）：未覆盖传 -1
    assert.equal(connect.callTimeoutMs, -1); // 未覆盖 → Kotlin 默认整调用预算 600s

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });
    await promise;
  });

  it("nativeTimeouts 覆盖传参（per-request 超时覆盖）", async () => {
    const mock = createMockBridge();
    const chunks: string[] = [];
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      (c) => chunks.push(c),
      { nativeTimeouts: { readMs: 5000, callMs: 120000 } },
    );
    const connect = mock.connects[0];
    assert.ok(connect != null);
    assert.equal(connect.readTimeoutMs, 5000);
    assert.equal(connect.callTimeoutMs, 120000);

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: connect.requestId, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: connect.requestId });
    await promise;
  });

  it("core 下发 wholeCallTimeoutMs：作为第 6 参透传给 sseConnect（单点整调用预算）", async () => {
    const mock = createMockBridge();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
      { wholeCallTimeoutMs: 600_000 },
    );
    const connect = mock.connects[0];
    assert.ok(connect != null);
    assert.equal(connect.callTimeoutMs, 600_000);
    assert.equal(connect.readTimeoutMs, -1); // 读超时仍恒禁用

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: connect.requestId, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: connect.requestId });
    await promise;
  });

  it("wholeCallTimeoutMs 优先于 nativeTimeouts.callMs（core 单点口径覆盖本包扩展位）", async () => {
    const mock = createMockBridge();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
      { wholeCallTimeoutMs: 600_000, nativeTimeouts: { readMs: 5000, callMs: 120000 } },
    );
    const connect = mock.connects[0];
    assert.ok(connect != null);
    assert.equal(connect.callTimeoutMs, 600_000);
    assert.equal(connect.readTimeoutMs, 5000); // readMs 仍按接口兼容位透传（native 侧恒不用）

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId: connect.requestId, status: 200, contentType: null });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId: connect.requestId });
    await promise;
  });

  it("signal abort：调用 sseAbort 并以 AbortError 形态 reject", async () => {
    const mock = createMockBridge();
    const controller = new AbortController();
    const chunks: string[] = [];
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      (c) => chunks.push(c),
      { signal: controller.signal },
    );
    const requestId = mock.connects[0]?.requestId ?? "";
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: null });

    controller.abort();
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseAbortError);
      assert.equal(error.name, "AbortError");
      assert.equal(error.message, "Aborted");
      return true;
    });
    assert.deepEqual(mock.aborts, [requestId]);

    // abort 后 native 的迟到事件被忽略
    mock.emit(LLM_SSE_EVENT_ERROR, { requestId, kind: "network", message: "canceled" });
    assert.deepEqual(chunks, []);
  });

  it("已 aborted 的 signal：不发起 sseConnect，直接 reject", async () => {
    const mock = createMockBridge();
    const controller = new AbortController();
    controller.abort();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
      { signal: controller.signal },
    );
    await assert.rejects(promise, (error: unknown) => error instanceof NativeSseAbortError);
    assert.equal(mock.connects.length, 0);
    assert.equal(mock.aborts.length, 0);
  });

  it("流结束仍无 headers：以 network 错误 reject（不悬挂）", async () => {
    const mock = createMockBridge();
    const { promise, requestId } = startStream(mock);
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseTransportError);
      assert.equal(error.kind, "network");
      assert.equal(error.message, "stream ended before headers");
      return true;
    });
  });
});

describe("非 2xx 错误路径（对齐 XHR 分支 onload 语义）", () => {
  it("非 2xx：错误 body 不喂 onChunk，Done 时以 http 错误 reject（带摘要）", async () => {
    const mock = createMockBridge();
    const chunks: string[] = [];
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      (c) => chunks.push(c),
    );
    const requestId = mock.connects[0]?.requestId ?? "";

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 429, contentType: "application/json" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: '{"error":"rate limited"}' });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });

    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseTransportError);
      assert.equal(error.kind, "http");
      assert.equal(error.httpStatus, 429);
      assert.match(error.message, /^HTTP 429: /);
      assert.match(error.message, /rate limited/);
      return true;
    });
    assert.deepEqual(chunks, []); // 错误 body 不进 onChunk
  });

  it("超长错误 body 只保留前 500 字符摘要", async () => {
    const mock = createMockBridge();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
    );
    const requestId = mock.connects[0]?.requestId ?? "";
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 500, contentType: null });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "x".repeat(800) });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });

    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseTransportError);
      assert.ok(error.message.length < 520, "摘要应被截断");
      assert.ok(error.message.endsWith("…"));
      return true;
    });
  });
});

describe("flattenRequestHeaders", () => {
  it("Record 形态", () => {
    assert.deepEqual(flattenRequestHeaders({ A: "1", B: "2" }), ["A", "1", "B", "2"]);
  });

  it("数组形态（HeadersInit 的 [string, string][]）", () => {
    assert.deepEqual(
      flattenRequestHeaders([
        ["A", "1"],
        ["B", "2"],
      ]),
      ["A", "1", "B", "2"],
    );
  });

  it("Headers 实例形态（forEach 遍历；undici 会小写化头名，OkHttp 侧大小写不敏感）", () => {
    const headers = new Headers();
    headers.set("Authorization", "Bearer tk");
    assert.deepEqual(flattenRequestHeaders(headers), ["authorization", "Bearer tk"]);
  });

  it("undefined 形态", () => {
    assert.deepEqual(flattenRequestHeaders(undefined), []);
  });
});
