import type {
  EventActionNode,
  EventActionType,
} from "@/domain/events-config/model/events-config.js";

export function createDefaultAction(type: EventActionType): EventActionNode {
  switch (type) {
    case "hide-message":
      return {
        type: "hide-message" as const,
        params: { startDepth: 6 },
      };
    case "refresh-macros":
      return { type: "refresh-macros" as const, params: {} };
    case "run-agent":
      return { type: "run-agent" as const, params: { agentId: "" } };
  }
}

/** User-selectable events (mobile/desktop only expose these). */
export type SupportedEventDefinition = {
  readonly eventType: string;
  readonly label: string;
  readonly hint: string;
  readonly defaultDag: readonly EventActionNode[];
};

export const SUPPORTED_EVENTS: readonly SupportedEventDefinition[] = [
  {
    eventType: "session.compaction.requested",
    label: "会话压缩",
    hint: "在手动压缩或自动压缩条件满足时执行下方动作。",
    defaultDag: [
      createDefaultAction("hide-message"),
      createDefaultAction("refresh-macros"),
    ],
  },
  {
    eventType: "session.message.received",
    label: "收到助手消息后",
    hint: "在助手回复成功写入会话后执行下方动作。",
    defaultDag: [createDefaultAction("refresh-macros")],
  },
];

export function isSupportedEventType(eventType: string): boolean {
  const key = eventType.trim();
  return SUPPORTED_EVENTS.some((e) => e.eventType === key);
}

export function supportedEventDefinition(
  eventType: string,
): SupportedEventDefinition | undefined {
  return SUPPORTED_EVENTS.find((e) => e.eventType === eventType.trim());
}

export function defaultDagForEvent(eventType: string): readonly EventActionNode[] {
  const def = supportedEventDefinition(eventType);
  if (def == null) {
    return [
      createDefaultAction("hide-message"),
      createDefaultAction("refresh-macros"),
    ];
  }
  return [...def.defaultDag];
}

export const EVENT_ADD_OPTIONS: readonly {
  readonly label: string;
  readonly eventType: string;
}[] = SUPPORTED_EVENTS.map((e) => ({
  label: e.label,
  eventType: e.eventType,
}));

export const ACTION_ADD_OPTIONS: readonly {
  readonly label: string;
  readonly type: EventActionType;
}[] = [
  { label: "隐藏消息", type: "hide-message" },
  { label: "刷新目录宏", type: "refresh-macros" },
  { label: "运行 Agent", type: "run-agent" },
];

export function eventTypeLabel(eventType: string): string {
  const def = supportedEventDefinition(eventType);
  if (def != null) {
    return def.label;
  }
  const trimmed = eventType.trim();
  return trimmed || "未知事件";
}

export function eventTypeHint(eventType: string): string {
  const def = supportedEventDefinition(eventType);
  if (def != null) {
    return def.hint;
  }
  return "此事件不在应用支持列表中；可删除该块后通过「添加」重新选择。";
}

export function actionTypeLabel(type: EventActionType): string {
  switch (type) {
    case "hide-message":
      return "隐藏消息";
    case "refresh-macros":
      return "刷新目录宏";
    case "run-agent":
      return "运行 Agent";
    default:
      return type;
  }
}

export function actionTypeHint(type: EventActionType): string {
  switch (type) {
    case "hide-message":
      return "按「距最新消息的深度」隐藏一部分可见消息。0 表示最新一条。";
    case "refresh-macros":
      return "更新对话里工作区、文件树等宏内容。";
    case "run-agent":
      return "按 agentId 运行指定 Agent；本轮产生的消息不写入会话，工具调用仍可用。";
    default:
      return "";
  }
}
