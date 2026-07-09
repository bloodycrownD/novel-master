/**
 * 将 main 进程 eventBus 发布的事件转发至聚焦中的 renderer 窗口。
 * Agent 流式与 step 事件经 `nm:agent-stream` 通道推送；不含 run 生命周期登记。
 */
import type { WebContents } from "electron";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  type SimpleEventBus,
} from "@novel-master/core/events";
import { IPC_CHANNELS, type AgentStreamEventPayload } from "../../../shared/ipc-types.js";
import { desktopLogError } from "../log/desktop-log.js";

let getTargetWebContents: (() => WebContents | undefined) | undefined;
const subscriptions: Array<{ unsubscribe: () => void }> = [];

const FORWARDED_EVENTS = [
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STREAM_TOOL_USE,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_FAILED,
] as const;

/** 注册如何解析用于事件转发的 renderer webContents。 */
export function setEventBusForwardTarget(
  resolver: () => WebContents | undefined,
): void {
  getTargetWebContents = resolver;
}

function forwardEvent(type: string, payload: unknown): void {
  if (type === EVENT_AGENT_RUN_FAILED) {
    const failed = payload as { sessionId?: string; projectId?: string; error?: string };
    desktopLogError("agent run failed (forwarding to renderer)", {
      sessionId: failed.sessionId,
      projectId: failed.projectId,
      error: failed.error,
    });
  }
  const envelope: AgentStreamEventPayload = { type, payload };
  getTargetWebContents?.()?.send(IPC_CHANNELS.AGENT_STREAM, envelope);
}

/**
 * 将 runtime eventBus 订阅挂到 renderer IPC；返回 cleanup 供 quit / rebootstrap。
 */
export function attachEventBusForwarder(eventBus: SimpleEventBus): () => void {
  detachEventBusForwarder();

  for (const eventType of FORWARDED_EVENTS) {
    const sub = eventBus.subscribe(eventType, (payload: unknown) => {
      forwardEvent(eventType, payload);
    });
    subscriptions.push(sub);
  }

  return detachEventBusForwarder;
}

function detachEventBusForwarder(): void {
  for (const sub of subscriptions) {
    sub.unsubscribe();
  }
  subscriptions.length = 0;
}
