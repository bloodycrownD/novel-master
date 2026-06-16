/**
 * Agent runner 测试用 worktree 快照 mock。
 */
import { createSessionWorktreeSnapshotStore, type SessionWorktreeSnapshotStore, type WorktreeService } from "@novel-master/core/worktree";

/** 固定 display 的内存 worktree 快照存储。 */
export function mockWorktreeSnapshot(
  worktreeDisplay = "WT",
): SessionWorktreeSnapshotStore {
  const store = createSessionWorktreeSnapshotStore();
  const originalGetOrRefresh = store.getOrRefresh.bind(store);
  store.getOrRefresh = async (_p, _s, render) => {
    const rendered = await render();
    return originalGetOrRefresh(_p, _s, async () => ({
      worktreeDisplay: rendered.worktreeDisplay || worktreeDisplay,
      listRows: rendered.listRows,
    }));
  };
  return store;
}

/** 最小 WorktreeService mock（不调用 materialize）。 */
export function mockWorktreeService(
  worktreeDisplay = "WT",
  projectId = "test-project",
  sessionId = "test-session",
): WorktreeService {
  return {
    scope: { kind: "session", projectId, sessionId },
    renderDisplay: async () => worktreeDisplay,
    buildListRows: async () => [],
  } as unknown as WorktreeService;
}

/** 空 layout（仅运行时 chat）。 */
export const emptyPromptLayout = {
  persist: [],
  dynamic: [],
} as const;
