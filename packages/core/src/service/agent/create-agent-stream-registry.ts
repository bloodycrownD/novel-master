/**
 * {@link AgentStreamRegistry} 工厂：Map 薄封装。
 *
 * @module service/agent/create-agent-stream-registry
 */

import type {
  AgentStreamRegistry,
  AgentStreamRegistryHandle,
} from "./agent-stream-registry.port.js";

/**
 * 创建一个进程内的 AgentStreamRegistry（Map 薄封装）。
 *
 * - `register` 重置 partial 并签发新句柄（run 边界，新 run / 新会话从空开始）；
 * - `reset` 仅清空累积文本、保留句柄（step 边界，下一步从空开始）；
 * - `append` 拼接 delta；
 * - `get` 返回只读快照；
 * - `unregister` 带句柄所有权比对，防误删新 run 的 partial。
 */
export function createAgentStreamRegistry(): AgentStreamRegistry {
  interface Entry {
    text: string;
    thinking: string;
    handle: AgentStreamRegistryHandle;
  }

  const map = new Map<string, Entry>();
  // 单调递增的句柄序号；每次 register 自增并写入 Entry，作为所有权 token。
  let nextSeq = 1;

  return {
    register(sessionId) {
      const handle = String(nextSeq++);
      map.set(sessionId, { text: "", thinking: "", handle });
      return handle;
    },
    reset(sessionId) {
      const current = map.get(sessionId);
      if (current == null) {
        return;
      }
      // 只清累积文本，handle 保留——同一 run 内的 step 边界不换所有权。
      map.set(sessionId, { text: "", thinking: "", handle: current.handle });
    },
    append(sessionId, delta) {
      const current = map.get(sessionId);
      if (current == null) {
        return;
      }
      map.set(sessionId, {
        text:
          delta.text != null ? current.text + delta.text : current.text,
        thinking:
          delta.thinking != null
            ? current.thinking + delta.thinking
            : current.thinking,
        handle: current.handle,
      });
    },
    get(sessionId) {
      const current = map.get(sessionId);
      if (current == null) {
        return undefined;
      }
      return { text: current.text, thinking: current.thinking };
    },
    has(sessionId) {
      return map.has(sessionId);
    },
    unregister(sessionId, handle) {
      const current = map.get(sessionId);
      if (current == null) {
        return;
      }
      // 所有权比对：handle 一致才删。handle 省略时（兼容路径）直接删。
      if (handle != null && current.handle !== handle) {
        return;
      }
      map.delete(sessionId);
    },
  };
}
