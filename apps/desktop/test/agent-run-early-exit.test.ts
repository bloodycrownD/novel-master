/**
 * C-orch-1 (T-CF2)：handleAgentRun 在 RUN_STARTED 之前 reject / 早退时，
 * finally 兜底分支必须递减 refcount，否则 isDesktopAgentActive() 永久 true，
 * 后续 run 全部被 AGENT_BUSY 门禁挡掉。
 *
 * 用 node:module 的 register() 挂一个 loader hook，把 agent.ts 引用的
 * desktop-runtime-singleton 与 agent-run.service 重定向到 mock 模块，
 * 让 handleAgentRun 在不拉起真实 SQLite runtime 的前提下跑到 finally 早退分支。
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
  new URL("./agent-run-early-exit-mock-hook.mjs", import.meta.url),
  import.meta.url,
);

const { handleAgentRun, __testRunTrackingState } = await import(
  "../src/main/ipc/handlers/agent.js"
);

/** 等待 fire-and-forget 的 runAgentTurn 走完 catch+finally 的微任务队列。 */
async function waitForBackgroundFinally(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe("C-orch-1 handleAgentRun 早退兜底", () => {
  afterEach(() => {
    while (isDesktopAgentActive()) {
      decrementDesktopAgentActive();
    }
  });

  it("RUN_STARTED 之前 reject 时 refcount 回落到 0，再次 run 不被 AGENT_BUSY 挡，map 无泄漏", async () => {
    const before = __testRunTrackingState();

    const first = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-early-exit",
      userContent: "hi",
    });
    assert.equal(first.ok, true, "首次 run 应放行");
    await waitForBackgroundFinally();

    // ① refcount 必须 0；修复前这里永久为 true（C-orch-1 P0 bug）。
    assert.equal(
      isDesktopAgentActive(),
      false,
      "早退兜底必须递减 refcount（C-orch-1）",
    );

    // ② 再次调用不应被 AGENT_BUSY 门禁挡掉。
    const second = await handleAgentRun({
      projectId: "p1",
      sessionId: "s-early-exit",
      userContent: "again",
    });
    assert.equal(second.ok, true, "再次 run 不应返回 AGENT_BUSY");
    if (!second.ok) {
      assert.notEqual(second.error.code, "AGENT_BUSY");
    }
    await waitForBackgroundFinally();

    // ③ 早退分支必须清掉 activeRuns，map 大小回到测试前水位。
    const after = __testRunTrackingState();
    assert.equal(
      after.activeRunsCount,
      before.activeRunsCount,
      "activeRuns 不应泄漏 entry",
    );
    assert.equal(
      after.sessionRunIdsCount,
      before.sessionRunIdsCount,
      "sessionRunIds 不应残留",
    );
    assert.equal(isDesktopAgentActive(), false, "两次早退后 refcount 仍归零");
  });
});
