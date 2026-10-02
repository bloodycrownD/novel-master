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
 *   的 `unregister`；
 * - `tryRegister` 是与 `register` 并行的 claim 语义：已注册则**不覆盖**、
 *   返回 false，供并发硬互斥用（判重 + 写入同同步段，同 step 并发一成一败）。
 */
export function createAgentAbortRegistry(): AgentAbortRegistry {
  const map = new Map<string, AbortController>();

  return {
    register(sessionId, controller) {
      map.set(sessionId, controller);
    },
    tryRegister(sessionId, controller) {
      // 判重与写入同同步段完成：已占用则一个字节都不动（不覆盖既有 controller）。
      if (map.has(sessionId)) {
        return false;
      }
      map.set(sessionId, controller);
      return true;
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
