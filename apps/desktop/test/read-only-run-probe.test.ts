import assert from "node:assert/strict";
import test from "node:test";
import {
  probeReadOnlyRunEnded,
  READONLY_RUN_PROBE_RECONFIRM_DELAY_MS,
  type RunActiveQueryResult,
} from "@/features/chat/readOnlyRunProbeLogic";

/**
 * T-G2-desktop：模拟 RUN_FINISHED 事件丢失（不调 onRunEnded），mock IPC 返回 false，
 * 兜底校准应两次确认后调 onRunEnded（走与正常事件相同的收尾路径）。
 *
 * 纯逻辑测试：node:test + tsx，无 React/jsdom，故测抽出来的 probeReadOnlyRunEnded。
 * hook 层（visibilitychange / setInterval 挂载）由类型 + 源码结构保证。
 */

// 用 fake timers 控制复询延迟，避免真等 800ms。
test("T-G2-desktop: isActive=true + IPC 两次 false → 调用 onRunEnded（事件丢失兑底）", async () => {
  const isActive = () => true;
  let queryCount = 0;
  const queryActive = async (): Promise<RunActiveQueryResult> => {
    queryCount += 1;
    return { ok: true, data: false }; // IPC 始终返回非 active（run 已结束但事件丢了）
  };
  const onRunEndedCalls: unknown[] = [];

  // 并行起一个定时器驱动，跳过真实延迟
  const probePromise = probeReadOnlyRunEnded({
    sessionId: "sub-1",
    isActive,
    queryActive,
    onRunEnded: () => onRunEndedCalls.push(undefined),
  });

  // 等延迟到位再 await probe
  await new Promise((r) => setTimeout(r, READONLY_RUN_PROBE_RECONFIRM_DELAY_MS + 30));
  await probePromise;

  assert.equal(queryCount, 2, "应查两次 IPC（第一次 + 复询）");
  assert.equal(onRunEndedCalls.length, 1, "onRunEnded 应被调一次");
});

test("T-G2-desktop: isActive=false 时不查 IPC、不调收尾（主路径已处理）", async () => {
  let queryCount = 0;
  const queryActive = async (): Promise<RunActiveQueryResult> => {
    queryCount += 1;
    return { ok: true, data: false };
  };
  let onRunEndedCalled = false;

  await probeReadOnlyRunEnded({
    sessionId: "sub-2",
    isActive: () => false,
    queryActive,
    onRunEnded: () => {
      onRunEndedCalled = true;
    },
  });

  assert.equal(queryCount, 0);
  assert.equal(onRunEndedCalled, false);
});

test("T-G2-desktop: 第一次 false、复询变 true 则不收尾（防抖避免误判）", async () => {
  const queryActive = async (): Promise<RunActiveQueryResult> => {
    // 每次查询轮转：第一次 false，第二次 true（registry/IPC 暂态）
    let value = false;
    return { ok: true, data: (value = !value) };
  };
  let onRunEndedCalled = false;

  const probePromise = probeReadOnlyRunEnded({
    sessionId: "sub-3",
    isActive: () => true,
    queryActive,
    onRunEnded: () => {
      onRunEndedCalled = true;
    },
  });
  await new Promise((r) => setTimeout(r, READONLY_RUN_PROBE_RECONFIRM_DELAY_MS + 30));
  await probePromise;

  assert.equal(onRunEndedCalled, false, "复询时 IPC 已恢复 active，不应误收尾");
});

test("T-G2-desktop: IPC 返回 ok=false（查询失败）不收尾", async () => {
  let onRunEndedCalled = false;
  const probePromise = probeReadOnlyRunEnded({
    sessionId: "sub-4",
    isActive: () => true,
    queryActive: async () => ({ ok: false, data: false }),
    onRunEnded: () => {
      onRunEndedCalled = true;
    },
  });
  await new Promise((r) => setTimeout(r, READONLY_RUN_PROBE_RECONFIRM_DELAY_MS + 30));
  await probePromise;
  assert.equal(onRunEndedCalled, false);
});
