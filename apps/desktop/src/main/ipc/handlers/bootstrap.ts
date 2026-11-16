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
    const built = await getDesktopRuntime();
    // 装配的已知失败沿 Result 到达（错误通道迁移七期），就地转码；未知异常仍走 catch。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    return { ok: true, status: "ready", dbPath: built.value.dbPath };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleBootstrapRebootstrap(): Promise<BootstrapRebootstrapResponse> {
  try {
    const rebuilt = await rebootstrapDesktopRuntime();
    if (!rebuilt.ok) return { ok: false, error: formatIpcError(rebuilt.error) };
    return { ok: true, status: "ready", dbPath: rebuilt.value.dbPath };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
