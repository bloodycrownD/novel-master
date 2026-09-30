/**
 * r3-run-1/2 单测专用 mock：agent-run.service。
 *
 * 关键点是 **runAgentTurn 的 settle 由测试显式控制**——本组用例要复刻的形态
 * 全都是「promise 还没 settle，但终态事件已经到了」（core 前奏期秒级窗口里
 * 发完 FINISHED('') 就返回），以及「STARTED 到了但终态一个都没来」。
 * 自动 reject 的 mock 排不掉这个时序，只能手动闸门。
 */

let pending = null;

/** 当前是否有未 settle 的 run（测试自检用）。 */
export function __hasPendingRun() {
  return pending != null;
}

/** 让挂起的 run 以 resolve 收尾（模拟 core 正常返回）。 */
export function __settleRun(value) {
  const p = pending;
  pending = null;
  p?.resolve(value ?? { stepsExecuted: 0, finished: true, stopReason: "completed", rounds: [] });
}

/** 让挂起的 run 以 reject 收尾（模拟 core 抛错）。 */
export function __failRun(error) {
  const p = pending;
  pending = null;
  p?.reject(error ?? new Error("prelude boom"));
}

export async function resolveCurrentAgentId() {
  return "agent-test";
}

export async function resolveCurrentAgentDefinition() {
  return {
    agentId: "agent-test",
    definition: { name: "测试 Agent", mode: "primary" },
  };
}

export async function resolveDesktopSavedModelId() {
  return { savedModelId: "model-test", workspaceModelId: "" };
}

export function runAgentTurn() {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
  });
}
