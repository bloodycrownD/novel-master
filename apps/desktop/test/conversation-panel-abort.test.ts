import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import {
  handleRunFinishedAbortRetain,
  handleStepCommittedAbortRetain,
  shouldAcceptStreamIngress,
  shouldReloadOnRunFinished,
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

/**
 * r3-run-1 步骤 4：前奏终态（runId === ''）强制全量 reload。
 *
 * 「发送→立刻停止」这一格是本条的全部意义：abort 先行让 uiRunning=false、
 * freezeCount!=null，既有判据两个条件都不满足；而这一轮既没有 step 也没有
 * assistant 增量可等，overlay 兜底又因无半截文本而空转——不强制 reload 的话，
 * 用户消息凭空消失。
 */
describe("T-PRELUDE-RELOAD：前奏终态强制 reload", () => {
  it("「发送→立刻停止」形态（uiRunning=false + freeze!=null）仍 reload", () => {
    assert.equal(shouldReloadOnRunFinished(false, 5, ""), true);
  });

  it("前奏终态的其它形态一律 reload（无 delta 可增量更新）", () => {
    assert.equal(shouldReloadOnRunFinished(true, null, ""), true);
    assert.equal(shouldReloadOnRunFinished(true, 0, ""), true);
    assert.equal(shouldReloadOnRunFinished(false, null, ""), true);
  });

  it("普通 runId 仍走既有判据，不被这条规则放宽", () => {
    assert.equal(shouldReloadOnRunFinished(false, 5, "run-1"), false);
    assert.equal(shouldReloadOnRunFinished(false, null, "run-1"), false);
    assert.equal(shouldReloadOnRunFinished(true, null, "run-1"), true);
    assert.equal(shouldReloadOnRunFinished(true, 3, "run-1"), false);
  });
});
