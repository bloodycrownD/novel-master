/**
 * Agent runner 测试用 worktree block store mock。
 */
import {
  createSessionWorktreeBlockStore,
  type SessionWorktreeBlockStore,
  type WorktreeService,
} from "@novel-master/core/worktree";

/** 预 capture 固定 display 的内存 block store。 */
export function mockWorktreeBlockStore(
  worktreeDisplay = "WT",
  projectId = "test-project",
  sessionId = "test-session",
): SessionWorktreeBlockStore {
  const store = createSessionWorktreeBlockStore();
  store.capture(projectId, sessionId, { worktreeDisplay });
  return store;
}

/** @deprecated 使用 {@link mockWorktreeBlockStore} */
export function mockWorktreeSnapshot(
  worktreeDisplay = "WT",
): SessionWorktreeBlockStore {
  return mockWorktreeBlockStore(worktreeDisplay);
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
    materializePersistBlock: async () => ({ worktreeDisplay }),
  } as unknown as WorktreeService;
}

/** 空 layout（仅运行时 chat）。 */
export const emptyPromptLayout = {
  persist: [],
  dynamic: [],
} as const;
