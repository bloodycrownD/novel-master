import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { LogFactory } from "@novel-master/core/log";
import { ShellMenu } from "../../shell-menu.js";
import type { IpcResult, ShellMenuPopupRequest, ShellMenuId } from "../../../../shared/ipc-types.js";

const log = LogFactory.create("desktop.shell-menu");

const MENU_IDS = new Set<ShellMenuId>(["file", "edit", "view", "window", "help"]);

export const Shell = {
    menuPopup(event: IpcMainInvokeEvent, req: ShellMenuPopupRequest): IpcResult<null> {
        if (!MENU_IDS.has(req.menuId)) {
            return { ok: false, error: { code: "IPC_INVALID_MENU", message: "未知菜单" } };
        }
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            return { ok: false, error: { code: "IPC_NO_WINDOW", message: "窗口不可用" } };
        }
        ShellMenu.popupSubmenu(req.menuId, window, req.x, req.y);
        return { ok: true, data: null };
    },

    setTitleBarTheme(event: IpcMainInvokeEvent, theme: "light" | "dark"): IpcResult<null> {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) {
            return { ok: false, error: { code: "IPC_NO_WINDOW", message: "窗口不可用" } };
        }
        // 原 syncTitleBarOverlay 内联：仅 win32 且窗口未销毁时更新标题栏叠层主题，失败只留痕。
        if (process.platform === "win32" && !window.isDestroyed()) {
            try {
                window.setTitleBarOverlay(ShellMenu.titleBarOverlayOptions(theme));
            } catch (error) {
                log.warn("titleBarOverlay update skipped", { error });
            }
        }
        return { ok: true, data: null };
    },
} as const;
