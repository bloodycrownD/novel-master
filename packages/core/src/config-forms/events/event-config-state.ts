/**
 * 事件配置 UI 草稿状态（块数组 ↔ KKV 文档）。
 */
import type {
  EventActionNode,
  EventsConfig,
} from "@/domain/events-config/model/events-config.js";
import { newEventBlockId } from "./event-block-id.js";

export { newEventBlockId } from "./event-block-id.js";

/**
 * UI 不提供 endDepth 编辑；自 wire 加载后经本函数剥离。
 * 经 UI 保存会丢失 endDepth；runtime/schema 仍支持完整 DepthSlice。
 */
export function normalizeHideMessageAction(action: EventActionNode): EventActionNode {
  if (action.type !== "hide-message") {
    return action;
  }
  const { endDepth: _end, ...params } = action.params;
  return { ...action, params };
}

export type EventBlockDraft = {
  readonly id: string;
  eventType: string;
  actions: EventActionNode[];
};

export function configToEventBlocks(config: EventsConfig): EventBlockDraft[] {
  return Object.entries(config.events).map(([eventType, actions]) => ({
    id: newEventBlockId(),
    eventType,
    actions: actions.map(normalizeHideMessageAction),
  }));
}

export function eventBlocksToConfig(
  blocks: readonly EventBlockDraft[],
  schemaVersion: 2,
): EventsConfig {
  const events: Record<string, EventActionNode[]> = {};
  for (const block of blocks) {
    const key = block.eventType.trim();
    if (key === "") {
      continue;
    }
    events[key] = block.actions.map(normalizeHideMessageAction);
  }
  return { schemaVersion, events };
}
