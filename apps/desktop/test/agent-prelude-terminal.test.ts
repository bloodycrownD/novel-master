/**
 * r3-run-1 步骤 3 / r3-run-2 步骤 2：desktop main 的 run 登记收口。
 *
 * 复刻的三种形态（都用可控的 runAgentTurn 闸门精确控制时序，见 mock 注释）：
 *
 * 1. **前奏终态 FINISHED('')**：core 在前奏检查点命中，RUN_STARTED 还没发，
 *    entry.runId 仍是 null。修前 `trackedRunId !== ''` 直接 return →
 *    refcount 永久泄漏 → isDesktopAgentActive() 永远 true → 后续全部 AGENT_BUSY。
 * 2. **STARTED 无终态**（r3-run-2）：RUN_STARTED 到了但终态一个没来。
 *    .finally 必须兜住，且**不能**因为 runId 已回填就早退。
 * 3. **正常路径双发防线**：STARTED + 匹配 FINISHED 走 finishTrackedRun 收敛，
 *    .finally 拿到 undefined entry 直接早退——不双递减。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, describe, it } from "node:test";
import {
  decrementDesktopAgentActive,
  isDesktopAgentActive,
} from "../src/main/runtime/agent-activity.js";

// 必须在动态 import agent.ts 之前注册 hook，否则真实模块已加载、mock 不生效。
register(
  new URL("./agent-prelude-terminal-mock-hook.mjs", import.meta.url),
  import.meta.url,
);

const {
  handleAgentRun,
  onCoreRunStarted,
  onCoreRunFinished,
  onCoreRunFailed,
  __testRunTrackingState,
} = await import("../src/main/ipc/handlers/agent.js");

const { __settleRun, __failRun } = await import(
  "./agent-prelude-terminal-mock-agent-run.mjs"
);

/** 等待 fire-and-forget 的 runAgentTurn 走完 catch+finally 的微任务队列。 */
async function waitForBackgroundFinally(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe("r3-run-1/2 desktop main run 登记收口", () => {
  afterEach(() => {
    while (isDesktopAgentActive()) {
      decrementDesktopAgentActive();
    }
  });

  it("T-MAIN-PRELUDE-FINISHED: 前奏 FINISHED('') → activeRuns 清空 + refcount 归零", async () => {
    const before = __testRunTrackingState();

    const res = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-prelude-finished",
      userContent: "hi",
    });
    assert.equal(res.ok, true);
    assert.equal(isDesktopAgentActive(), true, "受理后 refcount 应为 1");

    // core 前奏检查点命中：RUN_STARTED 从未发出，终态 runId 是空串。
    onCoreRunFinished({
      projectId: "p1",
      sessionId: "s-prelude-finished",
      runId: "",
      stopReason: "cancelled",
      vfsMutated: false,
    });

    assert.equal(
      isDesktopAgentActive(),
      false,
      "前奏终态必须递减 refcount（修前永久 AGENT_BUSY）",
    );
    assert.equal(__testRunTrackingState().activeRunsCount, before.activeRunsCount);

    // run 随后才 resolve，.finally 拿到 undefined entry 直接早退 → 不双递减。
    __settleRun();
    await waitForBackgroundFinally();
    assert.equal(isDesktopAgentActive(), false, ".finally 不得把已收敛的 run 再减一次");
  });

  it("T-MAIN-PRELUDE-FAILED: 前奏 FAILED('') → 同款收敛，且 reject 后不双递减", async () => {
    const before = __testRunTrackingState();

    const res = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-prelude-failed",
      userContent: "hi",
    });
    assert.equal(res.ok, true);

    onCoreRunFailed({
      projectId: "p1",
      sessionId: "s-prelude-failed",
      runId: "",
      error: "前奏炸了",
    });
    assert.equal(isDesktopAgentActive(), false, "前奏 FAILED 同样要递减 refcount");

    __failRun(new Error("前奏炸了"));
    await waitForBackgroundFinally();
    assert.equal(isDesktopAgentActive(), false, "reject 后 .finally 不得双递减");
    assert.equal(__testRunTrackingState().activeRunsCount, before.activeRunsCount);
    assert.equal(
      __testRunTrackingState().sessionRunIdsCount,
      before.sessionRunIdsCount,
    );
  });

  it("T-MAIN-NO-TERMINAL: STARTED 已达但无终态 → .finally 兜住（terminalSeen 语义）", async () => {
    const before = __testRunTrackingState();

    const res = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-no-terminal",
      userContent: "hi",
    });
    assert.equal(res.ok, true);

    // RUN_STARTED 到达：entry.runId 被回填。
    onCoreRunStarted({
      sessionId: "s-no-terminal",
      projectId: "p1",
      runId: "run-x",
    });

    // 终态事件始终没来 → run 自身 reject。
    __failRun(new Error("无终态"));
    await waitForBackgroundFinally();

    // 修前判据是 `entry.runId != null → return`，这里会泄漏 refcount → 后续全部 AGENT_BUSY。
    assert.equal(
      isDesktopAgentActive(),
      false,
      "无终态事件时 .finally 必须兜底清理（terminalSeen 判据）",
    );
    assert.equal(__testRunTrackingState().activeRunsCount, before.activeRunsCount);
    assert.equal(
      __testRunTrackingState().sessionRunIdsCount,
      before.sessionRunIdsCount,
    );
  });

  it("T-MAIN-STALE-TERMINAL: 迟到的不匹配终态不误清在途 run（terminalSeen 的真实作用）", async () => {
    const before = __testRunTrackingState();

    const res = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-stale-terminal",
      userContent: "hi",
    });
    assert.equal(res.ok, true);
    onCoreRunStarted({
      sessionId: "s-stale-terminal",
      projectId: "p1",
      runId: "run-current",
    });

    // 上一轮 run 的迟到终态：runId 不匹配 → finishTrackedRun 必须拒绝，
    // 不得据此清掉本轮在途 run 的登记（那正是 terminalSeen 换掉
    // 「runId != null 就早退」要防的坑）。
    onCoreRunFinished({
      projectId: "p1",
      sessionId: "s-stale-terminal",
      runId: "run-previous",
      stopReason: "completed",
    });
    assert.equal(
      isDesktopAgentActive(),
      true,
      "stale 终态不得收敛本轮 run 的 refcount",
    );

    // 本轮 run 正常收尾（匹配终态）→ 收敛。
    onCoreRunFinished({
      projectId: "p1",
      sessionId: "s-stale-terminal",
      runId: "run-current",
      stopReason: "completed",
    });
    assert.equal(isDesktopAgentActive(), false);

    __settleRun();
    await waitForBackgroundFinally();
    assert.equal(isDesktopAgentActive(), false, "不得双递减");
    assert.equal(__testRunTrackingState().activeRunsCount, before.activeRunsCount);
  });

  it("T-MAIN-REPEAT: 前奏终态后同会话可立即再发（不残留 AGENT_BUSY）", async () => {
    const first = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-repeat",
      userContent: "hi",
    });
    assert.equal(first.ok, true);
    onCoreRunFinished({
      projectId: "p1",
      sessionId: "s-repeat",
      runId: "",
      stopReason: "cancelled",
      vfsMutated: false,
    });
    __settleRun();
    await waitForBackgroundFinally();

    const second = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-repeat",
      userContent: "again",
    });
    assert.equal(second.ok, true, "前奏终态后必须能立刻再发");
    if (!second.ok) {
      assert.notEqual(second.error.code, "AGENT_BUSY");
    }
    __settleRun();
    await waitForBackgroundFinally();
  });
});
