/**
 * 将 main 进程 eventBus 发布的事件转发至聚焦中的 renderer 窗口。
 * Agent 流式与 step 事件经 `nm:agent-stream` 通道推送；不含 run 生命周期登记。
 */
import {
    EVENT_AGENT_RUN_FAILED,
    EVENT_AGENT_RUN_FINISHED,
    EVENT_AGENT_RUN_STARTED,
    EVENT_AGENT_STEP_COMMITTED,
    EVENT_AGENT_STREAM_TEXT_DELTA,
    EVENT_AGENT_STREAM_THINKING_DELTA,
    EVENT_AGENT_STREAM_TOOL_USE,
    EVENT_AGENT_STREAM_USAGE,
    type SimpleEventBus,
} from "@novel-master/core/events";
import { LogFactory } from "@novel-master/core/log";
import { IPC_CHANNELS, type AgentStreamEventPayload } from "../../../shared/ipc-types.js";
import { EventForwarder } from "./event-forwarder.js";

const log = LogFactory.create("desktop.ipc.event-bus");

const FORWARDED_EVENTS = [
    EVENT_AGENT_STREAM_TEXT_DELTA,
    EVENT_AGENT_STREAM_THINKING_DELTA,
    EVENT_AGENT_STREAM_TOOL_USE,
    EVENT_AGENT_STREAM_USAGE,
    EVENT_AGENT_STEP_COMMITTED,
    EVENT_AGENT_RUN_STARTED,
    EVENT_AGENT_RUN_FINISHED,
    EVENT_AGENT_RUN_FAILED,
] as const;

/** 注册如何解析用于事件转发的 renderer webContents。 */
export const EventBusForwarder = EventForwarder.create<AgentStreamEventPayload, [SimpleEventBus]>(IPC_CHANNELS.AGENT_STREAM, {
    /** 将 runtime eventBus 订阅挂到 renderer IPC；cleanup 供 quit / rebootstrap。 */
    subscribe: (emit, eventBus) => {
        const subscriptions = FORWARDED_EVENTS.map((eventType) =>
            eventBus.subscribe(eventType, (payload: unknown) => {
                if (eventType === EVENT_AGENT_RUN_FAILED) {
                    const failed = payload as { sessionId?: string; projectId?: string; error?: string };
                    log.error("agent run failed (forwarding to renderer)", {
                        sessionId: failed.sessionId,
                        projectId: failed.projectId,
                        error: failed.error,
                    });
                }
                emit({ type: eventType, payload });
            }),
        );
        return () => {
            for (const sub of subscriptions) {
                sub.unsubscribe();
            }
        };
    },
});
