/**
 * PersistentPreferences IPC — typed v1/v2 Core port accessors.
 */
import type { IpcResult } from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";
import { ipcErr } from "../ipc-result.js";

export async function handlePreferencesGetLlmStream(): Promise<
  IpcResult<boolean>
> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const enabled = await rt.preferences.getLlmStreamEnabled();
    if (!enabled.ok) return ipcErr(formatIpcError(enabled.error));
    return { ok: true, data: enabled.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetLlmStream(
  enabled: boolean,
): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    await rt.preferences.setLlmStreamEnabled(enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesGetSubagentStream(): Promise<
  IpcResult<boolean>
> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const enabled = await rt.preferences.getSubagentStreamEnabled();
    if (!enabled.ok) return ipcErr(formatIpcError(enabled.error));
    return { ok: true, data: enabled.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetSubagentStream(
  enabled: boolean,
): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    await rt.preferences.setSubagentStreamEnabled(enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesGetThinkingContext(): Promise<
  IpcResult<boolean>
> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    const enabled = await rt.preferences.getThinkingContextEnabled();
    if (!enabled.ok) return ipcErr(formatIpcError(enabled.error));
    return { ok: true, data: enabled.value };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetThinkingContext(
  enabled: boolean,
): Promise<IpcResult<void>> {
  try {
    const built = await getDesktopRuntime();
    // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
    if (!built.ok) return { ok: false, error: formatIpcError(built.error) };
    const rt = built.value;
    await rt.preferences.setThinkingContextEnabled(enabled);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
