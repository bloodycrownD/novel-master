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

/**
 * 扁平键的 LRU Map（`createScopeKeyCache` 的同款淘汰语义，去掉 key/clearByProjectPrefix）。
 *
 * 成员名与原生 `Map` 对齐（`get` / `set` / `delete` / `clear` / `size`），
 * 便于把既有 `new Map()` 平直替换成本工厂、调用点零改动。
 *
 * 为什么不复用 createScopeKeyCache：它的返回类型把 `key(projectId, sessionId)`
 * 与 `clearByProjectPrefix` 列为必需成员，而以裸 sessionId 为键的表用不上这两条
 * —— 复用会产生两个从未被调用的死成员。
 */
export type LruMap<T> = {
  /** 当前条目数（测试/诊断用）。 */
  readonly size: number;
  get(k: string): T | undefined;
  set(k: string, value: T): void;
  delete(k: string): void;
  clear(): void;
};

export function createLruMap<T>(maxEntries: number): LruMap<T> {
  const entries = new Map<string, T>();
  return {
    get size() {
      return entries.size;
    },
    get(k) {
      const hit = entries.get(k);
      // 命中判据用 has 而非 `hit !== undefined`：T 允许 undefined 值时，
      // 后者会让那条永不刷新新鲜度 ⇒ 被优先淘汰（症状与病因相距甚远）。
      if (entries.has(k)) {
        // LRU：命中即刷新新鲜度。
        entries.delete(k);
        entries.set(k, hit as T);
      }
      return hit;
    },
    set(k, value) {
      entries.delete(k);
      entries.set(k, value);
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) {
          entries.delete(oldest);
        }
      }
    },
    delete(k) {
      entries.delete(k);
    },
    clear() {
      entries.clear();
    },
  };
}
