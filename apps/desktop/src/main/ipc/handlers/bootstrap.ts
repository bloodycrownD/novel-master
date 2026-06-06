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

function formatError(err: unknown): { code: string; message: string } {
  if (err instanceof Error) {
    return { code: err.name || "ERROR", message: err.message };
  }
  return { code: "ERROR", message: String(err) };
}

export async function handleBootstrapStatus(): Promise<BootstrapStatusResponse> {
  try {
    const rt = await getDesktopRuntime();
    return { ok: true, status: "ready", dbPath: rt.dbPath };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}

export async function handleBootstrapRebootstrap(): Promise<BootstrapRebootstrapResponse> {
  try {
    const rt = await rebootstrapDesktopRuntime();
    return { ok: true, status: "ready", dbPath: rt.dbPath };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  }
}
