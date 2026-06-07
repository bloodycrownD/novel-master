/**
 * PersistentPreferences IPC — typed v1/v2 Core port accessors.
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

export async function handlePreferencesGetLlmStream(): Promise<
  IpcResult<boolean>
> {
  try {
    const rt = await getDesktopRuntime();
    return { ok: true, data: await rt.preferences.getLlmStreamEnabled() };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetLlmStream(
  enabled: boolean,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.preferences.setLlmStreamEnabled(enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesGetShowFullToolParams(): Promise<
  IpcResult<boolean>
> {
  try {
    const rt = await getDesktopRuntime();
    return { ok: true, data: await rt.preferences.getShowFullToolParams() };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetShowFullToolParams(
  enabled: boolean,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.preferences.setShowFullToolParams(enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesGetCheckpointRetention(): Promise<
  IpcResult<number>
> {
  try {
    const rt = await getDesktopRuntime();
    return { ok: true, data: await rt.preferences.getCheckpointRetention() };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetCheckpointRetention(
  count: number,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.preferences.setCheckpointRetention(count);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
