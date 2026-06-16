/**
 * 编辑器专用：宽松加载事件配置 wire，未知 action 转为占位 draft。
 */
import type { EventActionNode } from "@/domain/events-config/model/events-config.js";
import { parseActionNode } from "@/domain/events-config/model/events-config.schema.js";
import { DEFAULT_EVENTS_CONFIG } from "@/domain/events-config/logic/default-events.js";
import { newEventBlockId } from "./event-block-id.js";
import type { EventBlockDraft } from "./event-config-state.js";

/** 事件配置 UI 仅编辑 startDepth；加载/保存时丢弃 endDepth。 */
export function normalizeHideMessageAction(action: EventActionNode): EventActionNode {
  if (action.type !== "hide-message") {
    return action;
  }
  const { endDepth: _end, ...params } = action.params;
  return { ...action, params };
}

export type UnknownActionDraft = {
  readonly kind: "unknown";
  readonly wireKey: string;
  readonly raw: unknown;
};

export type EventActionDraft = EventActionNode | UnknownActionDraft;

export type EventsEditorLoadResult = {
  readonly schemaVersion: 2;
  readonly blocks: EventBlockDraft[];
  readonly unknownActions: readonly string[];
};

export function isUnknownActionDraft(action: EventActionDraft): action is UnknownActionDraft {
  return "kind" in action && action.kind === "unknown";
}

export function isEventActionNode(action: EventActionDraft): action is EventActionNode {
  return !isUnknownActionDraft(action);
}

/** 从 wire 原始 action 项提取类型键（简写或单键对象）。 */
function extractWireKey(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed !== "" ? trimmed : "unknown";
  }
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const keys = Object.keys(raw as Record<string, unknown>);
    if (keys.length === 1) {
      return keys[0]!;
    }
  }
  return "unknown";
}

function defaultEditorLoadResult(): EventsEditorLoadResult {
  const config = DEFAULT_EVENTS_CONFIG;
  return {
    schemaVersion: 2,
    blocks: Object.entries(config.events).map(([eventType, actions]) => ({
      id: newEventBlockId(),
      eventType,
      actions: [...actions],
    })),
    unknownActions: [],
  };
}

/**
 * 宽松解析 wire 文档供编辑器展示；运行时仍走 strict decode。
 */
export function loadEventsConfigForEditor(raw: unknown): EventsEditorLoadResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultEditorLoadResult();
  }

  const doc = raw as Record<string, unknown>;
  const schemaVersion = doc.schemaVersion === 2 ? 2 : 2;
  const eventsRaw = doc.events;

  if (eventsRaw == null || typeof eventsRaw !== "object" || Array.isArray(eventsRaw)) {
    return defaultEditorLoadResult();
  }

  const unknownKeys = new Set<string>();
  const blocks: EventBlockDraft[] = [];

  for (const [eventType, actionsRaw] of Object.entries(eventsRaw as Record<string, unknown>)) {
    if (!Array.isArray(actionsRaw)) {
      continue;
    }

    const actions: EventActionDraft[] = [];
    for (const actionRaw of actionsRaw) {
      try {
        actions.push(normalizeHideMessageAction(parseActionNode(actionRaw)));
      } catch {
        const wireKey = extractWireKey(actionRaw);
        unknownKeys.add(wireKey);
        actions.push({ kind: "unknown", wireKey, raw: actionRaw });
      }
    }

    blocks.push({
      id: newEventBlockId(),
      eventType,
      actions,
    });
  }

  if (blocks.length === 0) {
    return defaultEditorLoadResult();
  }

  return {
    schemaVersion,
    blocks,
    unknownActions: [...unknownKeys],
  };
}
