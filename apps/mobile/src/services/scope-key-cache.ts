/**
 * Scope-keyed in-memory cache factory (`projectId:sessionId` keys).
 * 可选 `maxEntries` 启用 LRU：读取刷新新鲜度，插入超限时淘汰最旧条目。
 */
export type ScopeKeyCache<T> = {
  /** 当前条目数（测试/诊断用）。 */
  readonly size: number;
  key(projectId: string, sessionId: string): string;
  get(k: string): T | undefined;
  set(k: string, value: T): void;
  clear(k: string): void;
  clearAll(): void;
  /** 按项目前缀清理（项目删除后调用，避免会话级缓存残留）。 */
  clearByProjectPrefix(projectId: string): void;
};

const KEY_SEPARATOR = ':';

export function createScopeKeyCache<T>(
  options: {readonly maxEntries?: number} = {},
): ScopeKeyCache<T> {
  const {maxEntries} = options;
  const entries = new Map<string, T>();
  return {
    get size() {
      return entries.size;
    },
    key(projectId, sessionId) {
      return `${projectId}${KEY_SEPARATOR}${sessionId}`;
    },
    get(k) {
      const hit = entries.get(k);
      if (hit !== undefined) {
        // LRU：命中即刷新新鲜度。
        entries.delete(k);
        entries.set(k, hit);
      }
      return hit;
    },
    set(k, value) {
      entries.delete(k);
      entries.set(k, value);
      if (maxEntries != null && entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }
    },
    clear(k) {
      entries.delete(k);
    },
    clearAll() {
      entries.clear();
    },
    clearByProjectPrefix(projectId) {
      const prefix = `${projectId}${KEY_SEPARATOR}`;
      for (const k of [...entries.keys()]) {
        if (k.startsWith(prefix)) {
          entries.delete(k);
        }
      }
    },
  };
}
