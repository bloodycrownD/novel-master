/**
 * Events config IPC handlers + YAML dialog import/export.
 */
import { BrowserWindow } from "electron";
import type { IpcResult } from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  exportEventsYamlWithDialog,
  importEventsYamlWithDialog,
} from "../../services/events-yaml.service.js";
import { formatIpcError } from "../ipc-error.js";

export {
  handleEventsClearConfig,
  handleEventsGetConfig,
  handleEventsSetConfig,
} from "./events-config-handlers.js";

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

export async function handleEventsExportYaml(): Promise<
  IpcResult<"saved" | "cancelled">
> {
  try {
    const rt = await getDesktopRuntime();
    const result = await exportEventsYamlWithDialog(rt, parentWindow());
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleEventsImportYaml(): Promise<
  IpcResult<"imported" | "cancelled">
> {
  try {
    const rt = await getDesktopRuntime();
    const result = await importEventsYamlWithDialog(rt, parentWindow());
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
