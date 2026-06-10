/**
 * IPC handlers for app metadata and GitHub release update checks (main-process fetch).
 */

import { app, shell } from "electron";
import { formatIpcError } from "../format-ipc-error.js";
import { runUpdateCheck } from "../../services/update-check.service.js";
import type {
  AppCheckForUpdatesResponse,
  AppGetInfoResponse,
  AppOpenExternalRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";

export async function handleAppGetInfo(): Promise<AppGetInfoResponse> {
  try {
    return {
      ok: true,
      data: {
        version: app.getVersion(),
        platform: process.platform,
        name: app.getName(),
      },
    };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAppCheckForUpdates(): Promise<AppCheckForUpdatesResponse> {
  try {
    const data = await runUpdateCheck();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAppOpenExternal(
  req: AppOpenExternalRequest,
): Promise<IpcResult<void>> {
  try {
    const url = req.url?.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: { code: "INVALID_URL", message: "无效的链接" } };
    }
    await shell.openExternal(url);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
