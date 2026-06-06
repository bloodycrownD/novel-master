/**
 * Renderer-side IPC client — thin wrapper over preload bridge.
 */
import { IPC_CHANNELS, type BootstrapStatusResponse } from "../../shared/ipc-types.js";

function bridge() {
  if (!window.novelMasterDesktop) {
    throw new Error("novelMasterDesktop preload bridge is unavailable");
  }
  return window.novelMasterDesktop;
}

export async function getBootstrapStatus(): Promise<BootstrapStatusResponse> {
  return bridge().invoke<BootstrapStatusResponse>(IPC_CHANNELS.BOOTSTRAP_STATUS);
}

export async function rebootstrap(): Promise<BootstrapStatusResponse> {
  return bridge().invoke<BootstrapStatusResponse>(
    IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP,
  );
}

export function onAgentStream(
  callback: (payload: unknown) => void,
): () => void {
  return bridge().on(IPC_CHANNELS.AGENT_STREAM, callback);
}
