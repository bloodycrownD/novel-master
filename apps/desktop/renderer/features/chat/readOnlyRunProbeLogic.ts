/**
 * readOnly 子面板「生成中」兜底校准的纯逻辑（可独立测试）。
 *
 * 从 useReadOnlyRunProbe 抽出来，便于在 node:test（无 React/jsdom）环境下直接测
 * 「IPC 返回 false + 复询仍 false → 调收尾」的语义（T-G2-desktop）。
 */

/** 兜底查到 run 已结束后的复询防抖延迟：第一次 false 后短延迟再查一次仍 false 才收尾。 */
export const READONLY_RUN_PROBE_RECONFIRM_DELAY_MS = 800;

/** IPC 查询结果的最小契约（与 ipcAgentRunIsActive 的 { ok, data } 形态对齐）。 */
export type RunActiveQueryResult = { ok: boolean; data: boolean };

export type ProbeReadOnlyRunEndedParams = {
  sessionId: string;
  /** 同步读 uiRunning（第一次与复询前各读一次，避免 run 已被别处结束还重复收尾）。 */
  isActive(): boolean;
  /** 跨进程查 main 的 in-flight 状态。 */
  queryActive(sessionId: string): Promise<RunActiveQueryResult>;
  /** 走与 readOnlyOnRunFinished 相同的收尾路径。 */
  onRunEnded(): void;
};

/**
 * 校准一次：若 run 已不 active（IPC 两次确认），走收尾。
 *
 * 复询防抖：第一次查到非 active 后，等 {@link READONLY_RUN_PROBE_RECONFIRM_DELAY_MS}
 * 再查一次仍非 active 才认定 run 真的结束（避免 IPC 短暂抖动误判）。
 */
export async function probeReadOnlyRunEnded({
  isActive,
  queryActive,
  onRunEnded,
  sessionId,
}: ProbeReadOnlyRunEndedParams): Promise<void> {
  if (!isActive()) {
    return;
  }
  const first = await queryActive(sessionId);
  if (!first.ok || first.data) {
    return;
  }
  await delay(READONLY_RUN_PROBE_RECONFIRM_DELAY_MS);
  // 复询前再读一次 uiRunning：可能别的路径已经收尾了。
  if (!isActive()) {
    return;
  }
  const recheck = await queryActive(sessionId);
  if (!recheck.ok || recheck.data) {
    return;
  }
  onRunEnded();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
