/**
 * C-orch-1 单测专用 mock：agent-run.service。
 * runAgentTurnAdapter 立即 reject——模拟「RUN_STARTED 还没发就出错」的早退场景，
 * 让 handleAgentRun 走到 finally 的早退兜底分支。
 */

export async function resolveCurrentAgentDefinitionAdapter() {
  return {
    agentId: "agent-test",
    definition: { name: "测试 Agent", mode: "primary" },
  };
}

export async function resolveDesktopSavedModelId() {
  return { savedModelId: "model-test", workspaceModelId: "" };
}

export function runAgentTurnAdapter() {
  return Promise.reject(new Error("early-exit test boom"));
}
