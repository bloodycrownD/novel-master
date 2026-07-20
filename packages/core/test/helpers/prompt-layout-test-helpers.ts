/**
 * Agent runner 测试用 sessionKkv / worktree mock。
 */
import type { SessionKkvService } from "@novel-master/core/session-kkv";
import type { WorkplaceService } from "@novel-master/core/workplace";

/** 进程内内存 {@link SessionKkvService}（单测用）。 */
export function createMemorySessionKkv(): SessionKkvService {
  const map = new Map<string, string>();
  const slot = (sessionId: string, domain: string, key: string) =>
    `${sessionId}\0${domain}\0${key}`;
  return {
    async get(sessionId, domain, key) {
      return map.get(slot(sessionId, domain, key)) ?? null;
    },
    async set(sessionId, domain, key, value) {
      map.set(slot(sessionId, domain, key), value);
    },
    async delete(sessionId, domain, key) {
      map.delete(slot(sessionId, domain, key));
    },
    async clearDomain(sessionId, domain) {
      const prefix = `${sessionId}\0${domain}\0`;
      for (const k of [...map.keys()]) {
        if (k.startsWith(prefix)) {
          map.delete(k);
        }
      }
    },
    async clearSession(sessionId) {
      const prefix = `${sessionId}\0`;
      for (const k of [...map.keys()]) {
        if (k.startsWith(prefix)) {
          map.delete(k);
        }
      }
    },
    async listKeys(sessionId, domain) {
      const prefix = `${sessionId}\0${domain}\0`;
      return [...map.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
  };
}

/** @deprecated 使用 {@link createMemorySessionKkv} */
export function mockWorktreeBlockStore(
  _workplaceDisplay = "WT",
  _projectId = "test-project",
  _sessionId = "test-session",
): SessionKkvService {
  return createMemorySessionKkv();
}

/** @deprecated 使用 {@link createMemorySessionKkv} */
export function mockWorktreeSnapshot(
  workplaceDisplay = "WT",
): SessionKkvService {
  return mockWorktreeBlockStore(workplaceDisplay);
}

/** 最小 WorkplaceService mock（assemble 走 kkv；evaluateRuleView 仅兜底）。 */
export function mockWorkplaceService(
  workplaceDisplay = "WT",
  projectId = "test-project",
  sessionId = "test-session",
): WorkplaceService {
  return {
    scope: { kind: "session", projectId, sessionId },
    renderDisplay: async () => workplaceDisplay,
    buildListRows: async () => [],
    materializePersistBlock: async () => ({ workplaceDisplay }),
    evaluateRuleView: async () => ({
      rows: [],
      displayByPath: new Map(),
    }),
  } as unknown as WorkplaceService;
}

/** 空 layout（仅运行时 chat）。 */
export const emptyPromptLayout = {
  persist: [],
  dynamic: [],
} as const;
