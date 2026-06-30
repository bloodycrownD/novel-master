import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeStreamTailGenerating,
  DEFAULT_STREAM_TAIL_IDLE_MS,
} from "../../src/domain/chat/logic/compute-stream-tail-generating.js";

describe("computeStreamTailGenerating", () => {
  it("uiRunning=false 时恒为 false", () => {
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: false,
        msSinceLastStreamDelta: 0,
      }),
      false,
    );
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: false,
        msSinceLastStreamDelta: 10_000,
      }),
      false,
    );
  });

  it("uiRunning=true 且距上次 delta <300ms 时为 false", () => {
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: 0,
      }),
      false,
    );
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: DEFAULT_STREAM_TAIL_IDLE_MS - 1,
      }),
      false,
    );
  });

  it("uiRunning=true 且距上次 delta ≥300ms 时为 true", () => {
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: DEFAULT_STREAM_TAIL_IDLE_MS,
      }),
      true,
    );
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: 5_000,
      }),
      true,
    );
  });

  it("支持自定义 idleThresholdMs", () => {
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: 499,
        idleThresholdMs: 500,
      }),
      false,
    );
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: 500,
        idleThresholdMs: 500,
      }),
      true,
    );
  });
});
