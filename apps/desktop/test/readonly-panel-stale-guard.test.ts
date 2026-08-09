/**
 * T-CF3 (FR8-1)：readOnly 子面板放宽守卫契约单测。
 *
 * 覆盖关键不变量：
 * 1. mount 时 ipcAgentRunIsActive=true → markExternalRunActive → uiRunning=true，
 *    activeRunId 全程保持 null（不调 beginUiRun）。
 * 2. 迟到 RUN_FINISHED → 放宽 acceptRunEvent(非空 runId) 接受 → markExternalRunEnded
 *    → uiRunning=false。停止按钮能显能消，不卡死。
 * 3. 竞态防护（FR8-1 风险4）：IPC 往返期间迟到 RUN_FINISHED 先把 endedRef 置位 →
 *    后续 markExternalRunActive（IPC stale true resolve）退化为 no-op，uiRunning 不回 true。
 *
 * 这里直接测 useAgentRunLifecycle 的新方法 + readOnly 的 acceptRunEvent 放宽语义，
 * 因为 ConversationPanel 的 mount probe effect 内部调用的就是这些 lifecycle 方法；
 * lifecycle 层的 endedRef 状态机是竞态防护的核心。IPC 那一层用 mock 函数模拟时序。
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
  useAgentRunLifecycle,
  type AgentRunLifecycle,
} from "@/hooks/useAgentRunLifecycle";

function mountLifecycle(): AgentRunLifecycle {
  const api: { current?: AgentRunLifecycle } = {};
  function Harness() {
    api.current = useAgentRunLifecycle();
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  assert.ok(api.current);
  return api.current;
}

/** readOnly 放宽 acceptRunEvent 语义（与 ConversationPanel 里那条 useCallback 等价）。 */
function readOnlyAcceptRunEvent(runId: string | undefined): boolean {
  return runId != null && runId !== "";
}

describe("T-CF3 readOnly 子面板放宽守卫", () => {
  it("markExternalRunActive 只翻 uiRunning=true，activeRunId 保持 null", () => {
    const lifecycle = mountLifecycle();
    // 模拟 readOnly mount probe：ipcAgentRunIsActive 返回 true。
    lifecycle.markExternalRunActive();

    assert.equal(lifecycle.getUiRunning(), true, "uiRunning 应翻 true");
    // activeRunId 是 React state，renderToStaticMarkup 下不同步更新；
    // 用主会话守卫间接证明它仍为 null——shouldAcceptRunEvent(null, any)=false。
    assert.equal(
      lifecycle.acceptRunEvent("any-run"),
      false,
      "activeRunId 全程保持 null（不调 beginUiRun / 不设 activeRunId）",
    );
  });

  it("迟到 RUN_FINISHED 放宽接受 → markExternalRunEnded → uiRunning=false（不卡死）", () => {
    const lifecycle = mountLifecycle();
    lifecycle.markExternalRunActive();
    assert.equal(lifecycle.getUiRunning(), true);

    // readOnly 放宽守卫：任何非空 runId 都接受（与主会话 shouldAcceptRunEvent 不同）。
    const runId = "run-late-finished";
    assert.equal(
      readOnlyAcceptRunEvent(runId),
      true,
      "放宽守卫应接受非空 runId",
    );

    lifecycle.markExternalRunEnded();
    assert.equal(lifecycle.getUiRunning(), false, "停止按钮应消失");
    assert.equal(
      lifecycle.acceptRunEvent(runId),
      false,
      "activeRunId 仍为 null",
    );
  });

  it("竞态防护：迟到 RUN_FINISHED 先把 endedRef 置位 → stale IPC true 不再翻 true", () => {
    const lifecycle = mountLifecycle();

    // 模拟 FR8-1 风险4 时序：
    // 1. mount → 发 IPC（异步）
    // 2. IPC 往返期间，迟到 RUN_FINISHED 先到达 → markExternalRunEnded
    lifecycle.markExternalRunEnded();
    assert.equal(lifecycle.getUiRunning(), false);
    assert.equal(lifecycle.getExternalRunEnded(), true);

    // 3. IPC stale true resolve → mount effect 调 markExternalRunActive
    //    防护：endedRef 已置位 → 退化为 no-op，不翻 true。
    lifecycle.markExternalRunActive();
    assert.equal(
      lifecycle.getUiRunning(),
      false,
      "竞态防护：endedRef 置位后 markExternalRunActive 不翻 true",
    );
    assert.equal(lifecycle.getExternalRunEnded(), true);
  });

  it("resetUiForSessionChange 重置 endedRef，markExternalRunActive 恢复生效", () => {
    const lifecycle = mountLifecycle();
    lifecycle.markExternalRunEnded();
    assert.equal(lifecycle.getExternalRunEnded(), true);

    // sessionId 切换 → resetUiForSessionChange 清 endedRef
    lifecycle.resetUiForSessionChange();
    assert.equal(lifecycle.getExternalRunEnded(), false);
    assert.equal(lifecycle.getUiRunning(), false);

    lifecycle.markExternalRunActive();
    assert.equal(lifecycle.getUiRunning(), true, "重置后能正常翻 true");
  });

  it("beginUiRun 也重置 endedRef（主会话新 run 不受 readOnly ended 残留影响）", () => {
    const lifecycle = mountLifecycle();
    lifecycle.markExternalRunEnded();
    assert.equal(lifecycle.getExternalRunEnded(), true);

    lifecycle.beginUiRun();
    assert.equal(
      lifecycle.getExternalRunEnded(),
      false,
      "beginUiRun 应重置 endedRef",
    );
    assert.equal(lifecycle.getUiRunning(), true);
  });

  it("正常路径（无竞态）：mount probe true → 翻 true → run 结束 → 翻 false", () => {
    const lifecycle = mountLifecycle();

    // 模拟正常 IPC 往返：run 持续中。
    lifecycle.markExternalRunActive();
    assert.equal(lifecycle.getUiRunning(), true);

    // run 自然结束 → RUN_FINISHED 到达 → 放宽接受 → markExternalRunEnded
    assert.equal(readOnlyAcceptRunEvent("run-1"), true);
    lifecycle.markExternalRunEnded();
    assert.equal(lifecycle.getUiRunning(), false);
    assert.equal(lifecycle.acceptRunEvent("run-1"), false);
  });

  it("竞态校正复询：第一次 true 翻 true → 第二次 false 兑底翻 false", () => {
    const lifecycle = mountLifecycle();

    // 模拟 IPC 往返期间 run 结束但无迟到 FINISHED 到达：
    lifecycle.markExternalRunActive();
    assert.equal(lifecycle.getUiRunning(), true);

    // 第二次复询 = false（run 已结束）→ markExternalRunEnded 兄底
    lifecycle.markExternalRunEnded();
    assert.equal(
      lifecycle.getUiRunning(),
      false,
      "竞态校正复询应兄底翻 false，不卡死",
    );
  });
});
