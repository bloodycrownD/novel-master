/**
 * PersistentPreferences IPC — typed v1/v2 Core port accessors.
 */
import { clearAllUserOpsLog } from "@novel-master/core/chat";
import type { IpcResult } from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import { formatIpcError } from "../ipc-error.js";
import { notifyComposerAttachmentsSuggestToRenderer } from "../forward-composer-attachments-suggest.js";

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

export async function handlePreferencesGetUserOpsLogEnabled(): Promise<
  IpcResult<boolean>
> {
  try {
    const rt = await getDesktopRuntime();
    const enabled = await rt.preferences.getUserOpsLogEnabled();
    return { ok: true, data: enabled };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handlePreferencesSetUserOpsLogEnabled(
  enabled: boolean,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.preferences.setUserOpsLogEnabled(enabled);
    // M1：关闭开关时清空所有已知会话的存量 pending ops，并逐个推空 Composer 状态条
    if (!enabled) {
      const clearedSessionIds = clearAllUserOpsLog();
      for (const sessionId of clearedSessionIds) {
        notifyComposerAttachmentsSuggestToRenderer({
          sessionId,
          attachments: [],
        });
      }
    }
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
