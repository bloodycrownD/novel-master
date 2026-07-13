import assert from "node:assert/strict";
import test from "node:test";
import {
  handleRunFinishedAbortRetain,
  handleStepCommittedAbortRetain,
  shouldAcceptStreamIngress,
  type AbortRetainLifecycle,
} from "@/features/chat/conversation-abort-retain";

function mockLifecycle(
  overrides: Partial<AbortRetainLifecycle> = {},
): AbortRetainLifecycle {
  let abortRetainPending = true;
  return {
    getUiRunning: () => false,
    getTranscriptFreezeCount: () => 2,
    getAbortRetainPending: () => abortRetainPending,
    clearAbortRetainPending: () => {
      abortRetainPending = false;
    },
    ...overrides,
  };
}

test("T-ARP-D1：abort retain + STEP assistant → reload 后 overlay clear", async () => {
  const order: string[] = [];
  let cleared = false;
  const lifecycle = mockLifecycle();
  handleStepCommittedAbortRetain(
    {
      sessionId: "s1",
      projectId: "p1",
      runId: "r1",
      phase: "assistant",
    },
    lifecycle,
    async () => {
      order.push("reload");
    },
    () => {
      order.push("reset");
      cleared = true;
    },
  );
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.deepEqual(order, ["reload", "reset"]);
  assert.equal(cleared, true);
  assert.equal(lifecycle.getAbortRetainPending(), false);
});

test("T-ARP-D1：reload reject 仍 clearAbortRetainPending + onStreamReset", async () => {
  let resetCount = 0;
  const lifecycle = mockLifecycle();
  handleStepCommittedAbortRetain(
    {
      sessionId: "s1",
      projectId: "p1",
      runId: "r1",
      phase: "assistant",
    },
    lifecycle,
    async () => {
      throw new Error("reload fail");
    },
    () => {
      resetCount += 1;
    },
  );
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(resetCount, 1);
  assert.equal(lifecycle.getAbortRetainPending(), false);
});

test("T-ARP-D2：retain 完成后迟到 STEP tool_results 不 reload", async () => {
  let reloadCount = 0;
  handleStepCommittedAbortRetain(
    {
      sessionId: "s1",
      projectId: "p1",
      runId: "r1",
      phase: "tool_results",
    },
    mockLifecycle(),
    async () => {
      reloadCount += 1;
    },
    () => undefined,
  );
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(reloadCount, 0);
});

test("T-ARP-D2：retain 完成后迟到 STEP assistant 不二次 reload", async () => {
  let reloadCount = 0;
  const lifecycle = mockLifecycle({ getAbortRetainPending: () => false });
  handleStepCommittedAbortRetain(
    {
      sessionId: "s1",
      projectId: "p1",
      runId: "r1",
      phase: "assistant",
    },
    lifecycle,
    async () => {
      reloadCount += 1;
    },
    () => undefined,
  );
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(reloadCount, 0);
});

test("T-ARP-D3：uiRunning=false 时 stream ingress 丢弃 delta", () => {
  assert.equal(shouldAcceptStreamIngress(false), false);
  assert.equal(shouldAcceptStreamIngress(true), true);
});

test("T-ARP-D3：FINISHED defer — abortRetainPending 时不提前 onStreamReset", async () => {
  let resetCount = 0;
  const lifecycle = mockLifecycle();
  const accepted = handleRunFinishedAbortRetain(
    {
      sessionId: "s1",
      projectId: "p1",
      runId: "r1",
      stopReason: "cancelled",
    },
    lifecycle,
    {
      finishUiRun: () => true,
      shouldReloadAfterFinish: false,
      streamingText: "",
      sessionId: "s1",
      reloadMessages: async () => undefined,
      onStreamReset: () => {
        resetCount += 1;
      },
    },
  );
  assert.equal(accepted, true);
  assert.equal(resetCount, 0, "不应同步清空 overlay");
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(resetCount, 1, "fallback 完成后才 reset");
  assert.equal(lifecycle.getAbortRetainPending(), false);
});

test("T-ARP-D3：FINISHED fallback 失败仍 clearAbortRetainPending + onStreamReset", async () => {
  let resetCount = 0;
  const lifecycle = mockLifecycle();
  const accepted = handleRunFinishedAbortRetain(
    {
      sessionId: "s1",
      projectId: "p1",
      runId: "r1",
      stopReason: "cancelled",
    },
    lifecycle,
    {
      finishUiRun: () => true,
      shouldReloadAfterFinish: false,
      streamingText: "partial overlay",
      sessionId: "s1",
      reloadMessages: async () => {
        throw new Error("ipc fail");
      },
      onStreamReset: () => {
        resetCount += 1;
      },
    },
  );
  assert.equal(accepted, true);
  assert.equal(resetCount, 0);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(resetCount, 1);
  assert.equal(lifecycle.getAbortRetainPending(), false);
});
