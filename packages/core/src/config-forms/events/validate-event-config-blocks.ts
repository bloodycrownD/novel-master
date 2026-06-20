/**
 * 事件配置 UI 草稿保存前校验。
 */
import { validateDepthSlice } from "../shared/depth-slice.js";
import {
  EventActionDagError,
  validateEventActionDag,
} from "@/domain/events-config/logic/validate-event-action-dag.js";
import type { EventActionType } from "@/domain/events-config/model/events-config.js";
import type { EventBlockDraft } from "./event-config-state.js";
import { actionTypeLabel, eventTypeLabel } from "./event-config-labels.js";

function mapDagErrorToUserMessage(error: EventActionDagError, eventLabel: string): string {
  switch (error.code) {
    case "duplicate_action_type": {
      const type = error.actionType ?? "";
      return `「${eventLabel}」中动作「${actionTypeLabel(type as EventActionType)}」重复，请删除多余项后再保存`;
    }
    case "unknown_dependency": {
      const type = error.actionType ?? "";
      const dep = error.dependency ?? "";
      return `「${eventLabel}」中动作「${actionTypeLabel(type as EventActionType)}」依赖不存在的 ${dep}`;
    }
    case "self_dependency": {
      const type = error.actionType ?? "";
      return `「${eventLabel}」中动作「${actionTypeLabel(type as EventActionType)}」不能依赖自身`;
    }
    case "cycle":
      return `「${eventLabel}」中依赖存在循环（DAG 必须无环）`;
    default:
      return `「${eventLabel}」· ${error.message}`;
  }
}

export function validateEventConfigBlocks(
  blocks: readonly EventBlockDraft[],
): string | null {
  if (blocks.length === 0) {
    return "至少添加一个事件";
  }
  const seenEvents = new Set<string>();
  for (const block of blocks) {
    const key = block.eventType.trim();
    const eventLabel = eventTypeLabel(key);
    if (key === "") {
      return "请为每个事件选择类型";
    }
    if (seenEvents.has(key)) {
      return `事件「${eventLabel}」重复，请删除多余项后再保存`;
    }
    seenEvents.add(key);

    if (block.actions.length === 0) {
      return `「${eventLabel}」至少需要一个动作`;
    }

    for (const action of block.actions) {
      if (action.type === "run-agent") {
        const agentId =
          "agentId" in action.params ? String(action.params.agentId).trim() : "";
        if (agentId === "") {
          return `「${eventLabel}」· 运行 Agent：请填写 agentId`;
        }
        continue;
      }

      if (action.type !== "hide-message") {
        continue;
      }
      try {
        validateDepthSlice({
          startDepth: action.params.startDepth ?? undefined,
          endDepth: action.params.endDepth ?? undefined,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return `「${eventLabel}」· 隐藏消息：${msg}`;
      }
    }

    try {
      validateEventActionDag(block.actions);
    } catch (e: unknown) {
      if (e instanceof EventActionDagError) {
        return mapDagErrorToUserMessage(e, eventLabel);
      }
      throw e;
    }
  }
  return null;
}
