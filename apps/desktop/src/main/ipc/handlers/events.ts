/**
 * Events config IPC handlers + YAML dialog import/export.
 */
import { BrowserWindow } from "electron";
import type {
  EventsSetConfigRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  exportEventsYamlWithDialog,
  importEventsYamlWithDialog,
} from "../../services/events-yaml.service.js";
import { formatIpcError } from "../ipc-error.js";

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

export async function handleEventsGetConfig(): Promise<IpcResult<unknown>> {
  try {
    const rt = await getDesktopRuntime();
    const config = await rt.eventsConfig.getConfig();
    return { ok: true, data: config };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleEventsSetConfig(
  req: EventsSetConfigRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.eventsConfig.setConfig(
      req.config as Parameters<typeof rt.eventsConfig.setConfig>[0],
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleEventsClearConfig(): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.eventsConfig.clearConfig();
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
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
