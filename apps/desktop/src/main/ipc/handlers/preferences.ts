/**
 * PersistentPreferences IPC — sessionFsVersionCheck (cross-platform Core port).
 */
import type { IpcResult } from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";

export async function handlePreferencesGetSessionFsVersionCheck(): Promise<
  IpcResult<boolean>
> {
  try {
    const rt = await getDesktopRuntime();
    const enabled = await rt.preferences.getSessionFsVersionCheck();
    return { ok: true, data: enabled };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetSessionFsVersionCheck(
  enabled: boolean,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.preferences.setSessionFsVersionCheck(enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
