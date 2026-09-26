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
 * - `append` 追加 delta（parts 数组 push，不做字符串重建——per-delta 的
 *   `text + delta` 会随流长增长产生超线性累积与 GC 垃圾）；
 * - `get` 返回只读快照（读频低，物化点收敛到这里：join 一次）；
 * - `unregister` 带句柄所有权比对，防误删新 run 的 partial。
 */
export function createAgentStreamRegistry(): AgentStreamRegistry {
  interface Entry {
    /** text delta 分段（按到达序 push；物化 = join 一次）。 */
    textParts: string[];
    /** thinking delta 分段（同上）。 */
    thinkingParts: string[];
    handle: AgentStreamRegistryHandle;
  }

  const map = new Map<string, Entry>();
  // 单调递增的句柄序号；每次 register 自增并写入 Entry，作为所有权 token。
  let nextSeq = 1;

  return {
    register(sessionId) {
      const handle = String(nextSeq++);
      map.set(sessionId, { textParts: [], thinkingParts: [], handle });
      return handle;
    },
    reset(sessionId) {
      const current = map.get(sessionId);
      if (current == null) {
        return;
      }
      // 只清累积分段（复用数组实例，避免每 step 换新数组），handle 保留——
      // 同一 run 内的 step 边界不换所有权。
      current.textParts.length = 0;
      current.thinkingParts.length = 0;
    },
    append(sessionId, delta) {
      const current = map.get(sessionId);
      if (current == null) {
        return;
      }
      // 空字符串等价于不修改对应字段（port 契约），跳过 push 防数组虚长。
      if (delta.text != null && delta.text.length > 0) {
        current.textParts.push(delta.text);
      }
      if (delta.thinking != null && delta.thinking.length > 0) {
        current.thinkingParts.push(delta.thinking);
      }
    },
    get(sessionId) {
      const current = map.get(sessionId);
      if (current == null) {
        return undefined;
      }
      return {
        text: current.textParts.join(""),
        thinking: current.thinkingParts.join(""),
      };
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
