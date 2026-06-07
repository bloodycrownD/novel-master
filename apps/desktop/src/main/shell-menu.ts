/**
 * Application menu (accelerators + popup submenus for in-window menubar on Windows/Linux).
 */
import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from "electron";
import type { ShellMenuId } from "../../shared/ipc-types.js";

const isDev = !app.isPackaged;

let appMenu: Menu | null = null;

const TITLEBAR_OVERLAY = {
  light: { color: "#eef3fb", symbolColor: "#1a1d24" },
  dark: { color: "#14161a", symbolColor: "#f2f3f5" },
} as const;

const TITLEBAR_OVERLAY_HEIGHT = 40;

/** Must be passed in BrowserWindow constructor on Windows — setTitleBarOverlay alone fails otherwise. */
export function titleBarOverlayOptions(theme: "light" | "dark" = "light") {
  const palette = TITLEBAR_OVERLAY[theme];
  return {
    color: palette.color,
    symbolColor: palette.symbolColor,
    height: TITLEBAR_OVERLAY_HEIGHT,
  };
}

export function buildApplicationMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      id: "file",
      submenu: [{ role: "quit", label: "退出" }],
    },
    {
      label: "编辑",
      id: "edit",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      id: "view",
      submenu: [
        { role: "reload", label: "重新加载" },
        ...(isDev
          ? [{ role: "toggleDevTools" as const, label: "开发者工具" }]
          : []),
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "窗口",
      id: "window",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭窗口" },
      ],
    },
    {
      label: "帮助",
      id: "help",
      submenu: [
        {
          label: "关于 Novel Master",
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (!win) return;
            void dialog.showMessageBox(win, {
              type: "info",
              title: "关于",
              message: "Novel Master",
              detail: `版本 ${app.getVersion()}`,
            });
          },
        },
      ],
    },
  ];

  appMenu = Menu.buildFromTemplate(template);
  return appMenu;
}

export function installApplicationMenu(): void {
  Menu.setApplicationMenu(buildApplicationMenu());
}

export function popupShellSubmenu(
  menuId: ShellMenuId,
  window: BrowserWindow,
  x: number,
  y: number,
): void {
  const item = appMenu?.getMenuItemById(menuId);
  const submenu = item?.submenu;
  if (!submenu) return;
  submenu.popup({ window, x: Math.round(x), y: Math.round(y) });
}

export function configureWindowChrome(window: BrowserWindow): void {
  window.setTitle("");
  if (process.platform === "win32" || process.platform === "linux") {
    window.setMenuBarVisibility(false);
  }
}

export function syncTitleBarOverlay(
  window: BrowserWindow,
  theme: "light" | "dark",
): void {
  if (process.platform !== "win32" || window.isDestroyed()) return;
  try {
    window.setTitleBarOverlay(titleBarOverlayOptions(theme));
  } catch (error) {
    console.warn("[desktop] titleBarOverlay update skipped:", error);
  }
}
