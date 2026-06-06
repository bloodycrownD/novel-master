/**
 * Forwards main-process eventBus publishes to the focused renderer window.
 * D1 skeleton — D5+ will subscribe to agent-stream and compaction channels.
 */
import type { WebContents } from "electron";
import type { SimpleEventBus } from "@novel-master/core";
import { IPC_CHANNELS } from "../../../shared/ipc-types.js";

let getTargetWebContents: (() => WebContents | undefined) | undefined;
const subscriptions: Array<{ unsubscribe: () => void }> = [];

/** Registers how to resolve the renderer webContents for event forwarding. */
export function setEventBusForwardTarget(
  resolver: () => WebContents | undefined,
): void {
  getTargetWebContents = resolver;
}

/**
 * Attaches forwarders from runtime eventBus to renderer IPC.
 * Returns cleanup for app quit / rebootstrap.
 */
export function attachEventBusForwarder(eventBus: SimpleEventBus): () => void {
  detachEventBusForwarder();

  // Placeholder subscription — real event types wired in D5.
  const sub = eventBus.subscribe(IPC_CHANNELS.AGENT_STREAM, (payload: unknown) => {
    getTargetWebContents?.()?.send(IPC_CHANNELS.AGENT_STREAM, payload);
  });
  subscriptions.push(sub);

  return detachEventBusForwarder;
}

function detachEventBusForwarder(): void {
  for (const sub of subscriptions) {
    sub.unsubscribe();
  }
  subscriptions.length = 0;
}
