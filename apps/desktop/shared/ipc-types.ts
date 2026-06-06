/**
 * IPC channel names and serializable DTOs shared by main, preload, and renderer.
 * Single source of truth — handlers must not invent ad-hoc channel strings.
 */

export const IPC_CHANNELS = {
  BOOTSTRAP_STATUS: "nm:bootstrap/status",
  BOOTSTRAP_REBOOTSTRAP: "nm:bootstrap/rebootstrap",
  EVENT_BUS: "nm:event-bus",
  AGENT_STREAM: "nm:agent-stream",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export type IpcErrorPayload = {
  readonly code: string;
  readonly message: string;
};

export type BootstrapStatusReady = {
  readonly ok: true;
  readonly status: "ready";
  readonly dbPath: string;
};

export type BootstrapStatusFailed = {
  readonly ok: false;
  readonly error: IpcErrorPayload;
};

export type BootstrapStatusResponse =
  | BootstrapStatusReady
  | BootstrapStatusFailed;

export type BootstrapRebootstrapResponse = BootstrapStatusResponse;
