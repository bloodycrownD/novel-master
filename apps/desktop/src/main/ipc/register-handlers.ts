/**
 * Registers typed ipcMain handlers for all desktop domains.
 * D1: bootstrap only — additional domains added per milestone.
 */
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../../shared/ipc-types.js";
import {
  handleBootstrapRebootstrap,
  handleBootstrapStatus,
} from "./handlers/bootstrap.js";

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BOOTSTRAP_STATUS, () => handleBootstrapStatus());
  ipcMain.handle(IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP, () =>
    handleBootstrapRebootstrap(),
  );
}
