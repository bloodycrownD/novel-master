import assert from "node:assert/strict";
import test from "node:test";
import {
  stepCommittedShouldReload,
  type AbortRetainLifecycle,
} from "@/features/chat/conversation-abort-retain";

function mockLifecycle(
  overrides: Partial<AbortRetainLifecycle> = {},
): AbortRetainLifecycle {
  return {
    getUiRunning: () => false,
    getTranscriptFreezeCount: () => 2,
    getAbortRetainPending: () => true,
    clearAbortRetainPending: () => undefined,
    ...overrides,
  };
}

test("T-ARP-D1：abort retain + assistant phase 允许一次 reload", () => {
  assert.equal(
    stepCommittedShouldReload(mockLifecycle(), "assistant"),
    true,
  );
});

test("T-ARP-D2：abort retain + tool_results phase 禁止 reload", () => {
  assert.equal(
    stepCommittedShouldReload(mockLifecycle(), "tool_results"),
    false,
  );
});

test("T-ARP-D2：retain 完成后 freeze 禁止 assistant reload", () => {
  assert.equal(
    stepCommittedShouldReload(
      mockLifecycle({ getAbortRetainPending: () => false }),
      "assistant",
    ),
    false,
  );
});
