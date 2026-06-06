/**
 * Forwards main-process eventBus publishes to the focused renderer window.
 * Agent stream + step events are relayed on `nm:agent-stream`.
 */
import type { WebContents } from "electron";
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  type SimpleEventBus,
} from "@novel-master/core";
import { IPC_CHANNELS, type AgentStreamEventPayload } from "../../../shared/ipc-types.js";

let getTargetWebContents: (() => WebContents | undefined) | undefined;
const subscriptions: Array<{ unsubscribe: () => void }> = [];

const FORWARDED_EVENTS = [
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_THINKING_DELTA,
  EVENT_AGENT_STEP_COMMITTED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_RUN_FINISHED,
] as const;

/** Registers how to resolve the renderer webContents for event forwarding. */
export function setEventBusForwardTarget(
  resolver: () => WebContents | undefined,
): void {
  getTargetWebContents = resolver;
}

function forwardEvent(type: string, payload: unknown): void {
  const envelope: AgentStreamEventPayload = { type, payload };
  getTargetWebContents?.()?.send(IPC_CHANNELS.AGENT_STREAM, envelope);
}

/**
 * Attaches forwarders from runtime eventBus to renderer IPC.
 * Returns cleanup for app quit / rebootstrap.
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
