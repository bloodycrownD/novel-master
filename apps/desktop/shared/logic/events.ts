/**
 * Desktop renderer 对 `@novel-master/core/events` 的具名薄再导出（类型/常量）。
 * 禁止 `export *`；禁止 EventBus / createEventsConfigStore / decode 运行时进 renderer。
 *
 * 完整 EventsConfig 在 assess IPC 后优先走 ipc-types DTO。
 */

export type {
  EventActionNode,
  EventActionType,
  EventsConfig,
} from "@novel-master/core/events";
