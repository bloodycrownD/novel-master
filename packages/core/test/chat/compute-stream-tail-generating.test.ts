import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeStreamTailGenerating } from "../../src/domain/chat/logic/compute-stream-tail-generating.js";

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

  it("uiRunning=true 时恒为 true", () => {
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: 0,
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

  it("msSinceLastStreamDelta / idleThresholdMs 被忽略", () => {
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: true,
        msSinceLastStreamDelta: 0,
        idleThresholdMs: 500,
      }),
      true,
    );
    assert.equal(
      computeStreamTailGenerating({
        uiRunning: false,
        msSinceLastStreamDelta: 10_000,
        idleThresholdMs: 500,
      }),
      false,
    );
  });
});
