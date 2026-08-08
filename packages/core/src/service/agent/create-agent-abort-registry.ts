/**
 * {@link AgentAbortRegistry} 工厂：Map 薄封装。
 *
 * @module service/agent/create-agent-abort-registry
 */

import type { AgentAbortRegistry } from "./agent-abort-registry.port.js";

/**
 * 创建一个进程内的 AgentAbortRegistry（Map 薄封装）。
 *
 * - `unregister` 做严格 controller 引用比对，防误删新 run 的 controller；
 * - `abort` 拿到 controller 调 `.abort()` 后不删记录，删除交给 finally
 *   的 `unregister`。
 */
export function createAgentAbortRegistry(): AgentAbortRegistry {
  const map = new Map<string, AbortController>();

  return {
    register(sessionId, controller) {
      map.set(sessionId, controller);
    },
    abort(sessionId) {
      // 不删——删除由 finally 的 unregister 完成，避免 abort 与反注册的时序竞态。
      map.get(sessionId)?.abort();
    },
    unregister(sessionId, controller) {
      // 所有权比对：只有同一引用才删，防误删新 run 的 controller。
      if (map.get(sessionId) === controller) {
        map.delete(sessionId);
      }
    },
    has(sessionId) {
      return map.has(sessionId);
    },
  };
}
