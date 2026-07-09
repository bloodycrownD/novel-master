/**
 * Bootstrap IPC handlers — renderer probes main-process runtime readiness.
 */
import type {
  BootstrapRebootstrapResponse,
  BootstrapStatusResponse,
} from "../../../../shared/ipc-types.js";
import {
  getDesktopRuntime,
  rebootstrapDesktopRuntime,
} from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../format-ipc-error.js";

export async function handleBootstrapStatus(): Promise<BootstrapStatusResponse> {
  try {
    const rt = await getDesktopRuntime();
    return { ok: true, status: "ready", dbPath: rt.dbPath };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleBootstrapRebootstrap(): Promise<BootstrapRebootstrapResponse> {
  try {
    const rt = await rebootstrapDesktopRuntime();
    return { ok: true, status: "ready", dbPath: rt.dbPath };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
