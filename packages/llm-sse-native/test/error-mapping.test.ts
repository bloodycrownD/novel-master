/**
 * T-N2（wrapper 可测部分）：LlmSseError kind → transport 错误映射。
 *
 * callTimeout 触发的 native `LlmSseError(kind:"timeout")` 须原样携带 kind
 * 上抛（读超时已退役：恒禁用，仅存防御性文案路径）。core 侧（Step 3）据此
 * 映射 `LlmStreamTimeoutError` 分级（processedLength>0 → idle，否则
 * first-chunk），分级逻辑不在本包。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NativeSseTransportError,
  createNativeSseTransportFromBridge,
} from "../src/transport.js";
import {
  LLM_SSE_EVENT_CHUNK,
  LLM_SSE_EVENT_DONE,
  LLM_SSE_EVENT_ERROR,
  LLM_SSE_EVENT_HEADERS,
} from "../src/types.js";
import { createMockBridge } from "./mock-bridge.js";

describe("LlmSseError → transport 错误映射（T-N2）", () => {
  it('kind:"timeout"（callTimeout；原读超时口径已退役）原样携带，供 core 映射 LlmStreamTimeoutError', async () => {
    const mock = createMockBridge();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
    );
    const requestId = mock.connects[0]?.requestId ?? "";

    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: "text/event-stream" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "partial" });
    // 首字之后整调用 callTimeout 到点（读超时已退役）→ kind timeout
    mock.emit(LLM_SSE_EVENT_ERROR, { requestId, kind: "timeout", message: "timeout" });

    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseTransportError);
      assert.equal(error.kind, "timeout");
      assert.equal(error.requestId, requestId);
      return true;
    });
  });

  it('kind:"timeout" 在 0 数据阶段（首字黑洞）同样携带 kind（分级判定归 core）', async () => {
    const mock = createMockBridge();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
    );
    const requestId = mock.connects[0]?.requestId ?? "";
    // headers 之前就超时（connect/首字阶段，同由 callTimeout 覆盖）
    mock.emit(LLM_SSE_EVENT_ERROR, { requestId, kind: "timeout", message: "connect timeout" });

    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseTransportError);
      assert.equal(error.kind, "timeout");
      assert.equal(error.message, "connect timeout");
      return true;
    });
  });

  it('kind:"network"（连接失败 / 连接被重置）', async () => {
    const mock = createMockBridge();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
    );
    const requestId = mock.connects[0]?.requestId ?? "";
    mock.emit(LLM_SSE_EVENT_ERROR, { requestId, kind: "network", message: "Failed to connect" });

    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseTransportError);
      assert.equal(error.kind, "network");
      return true;
    });
  });

  it("未知 kind（native 侧扩展）按非法载荷忽略——不误 reject 既有流", async () => {
    const mock = createMockBridge();
    const chunks: string[] = [];
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      (c) => chunks.push(c),
    );
    const requestId = mock.connects[0]?.requestId ?? "";
    mock.emit(LLM_SSE_EVENT_HEADERS, { requestId, status: 200, contentType: null });
    // 伪造一个未来 kind：wrapper 无法识别，忽略而不是崩溃/误杀
    mock.emit(LLM_SSE_EVENT_ERROR, { requestId, kind: "future-kind", message: "?" });
    mock.emit(LLM_SSE_EVENT_CHUNK, { requestId, text: "still-alive" });
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });

    assert.deepEqual(await promise, { status: 200, contentType: null });
    assert.deepEqual(chunks, ["still-alive"]);
  });

  it("headers 前收到 Done 属 network 语义（headers 丢失，流异常终止）", async () => {
    const mock = createMockBridge();
    const promise = createNativeSseTransportFromBridge(mock.bridge).post(
      "https://example.test/stream",
      { method: "POST", body: "" },
      () => {},
    );
    const requestId = mock.connects[0]?.requestId ?? "";
    mock.emit(LLM_SSE_EVENT_DONE, { requestId });
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NativeSseTransportError);
      assert.equal(error.kind, "network");
      return true;
    });
  });
});
