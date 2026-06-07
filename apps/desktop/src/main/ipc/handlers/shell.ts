import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  popupShellSubmenu,
  syncTitleBarOverlay,
} from "../../shell-menu.js";
import type { IpcResult, ShellMenuPopupRequest, ShellMenuId } from "../../../../shared/ipc-types.js";

const MENU_IDS = new Set<ShellMenuId>(["file", "edit", "view", "window", "help"]);

export function handleShellMenuPopup(
  event: IpcMainInvokeEvent,
  req: ShellMenuPopupRequest,
): IpcResult<null> {
  if (!MENU_IDS.has(req.menuId)) {
    return { ok: false, error: { code: "INVALID_MENU", message: "未知菜单" } };
  }
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { ok: false, error: { code: "NO_WINDOW", message: "窗口不可用" } };
  }
  popupShellSubmenu(req.menuId, window, req.x, req.y);
  return { ok: true, data: null };
}

export function handleShellSetTitleBarTheme(
  event: IpcMainInvokeEvent,
  theme: "light" | "dark",
): IpcResult<null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return { ok: false, error: { code: "NO_WINDOW", message: "窗口不可用" } };
  }
  syncTitleBarOverlay(window, theme);
  return { ok: true, data: null };
}
