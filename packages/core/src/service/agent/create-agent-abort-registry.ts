/**
 * {@link AgentAbortRegistry} 工厂：Map 薄封装。
 *
 * @module service/agent/create-agent-abort-registry
 */

import { scopeFromController } from "@/domain/abort/logic/create-abort-scope.js";
import type { AbortScope } from "@/domain/abort/model/abort-scope.js";
import type { AgentAbortRegistry } from "./agent-abort-registry.port.js";

/**
 * 创建一个进程内的 AgentAbortRegistry（scope 薄包装）。
 *
 * register/tryRegister 内部走 `scopeFromController(controller)`，与 run 根 scope
 * 共用同一 WeakMap memoize 实例（spec §二：**不另建缓存 Map**）——因此
 * `abort(sessionId)` 命中的 scope 就是 run-agent-turn 里的根 scope，
 * `reason` 会如实记为 `"user-stop"`（T-S24）。
 *
 * - `unregister` 经同一 memoize 实例做严格引用比对，防误删新 run；
 * - `abort` 后不删记录，删除交给 finally 的 `unregister`；
 * - `tryRegister` 是与 `register` 并行的 claim 语义：已注册则**不覆盖**、
 *   返回 false，供并发硬互斥用（判重 + 写入同同步段，同 step 并发一成一败）。
 */
export function createAgentAbortRegistry(): AgentAbortRegistry {
  const scopes = new Map<string, AbortScope>();

  return {
    register(sessionId, controller) {
      scopes.set(sessionId, scopeFromController(controller));
    },
    tryRegister(sessionId, controller) {
      // 判重与写入同同步段完成：已占用则一个字节都不动（不覆盖既有 scope）。
      if (scopes.has(sessionId)) {
        return false;
      }
      scopes.set(sessionId, scopeFromController(controller));
      return true;
    },
    abort(sessionId) {
      // 不删——删除由 finally 的 unregister 完成，避免 abort 与反注册的时序竞态。
      // scope.abort 内部会 controller.abort()，并把 reason 记为 user-stop。
      scopes.get(sessionId)?.abort("user-stop");
    },
    unregister(sessionId, controller) {
      // 所有权比对：只有同一 controller 对应的 memoize 实例才删，防误删新 run。
      if (scopes.get(sessionId) === scopeFromController(controller)) {
        scopes.delete(sessionId);
      }
    },
    has(sessionId) {
      return scopes.has(sessionId);
    },
  };
}
