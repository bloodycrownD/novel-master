/**
 * Application menu (accelerators + popup submenus for in-window menubar on Windows/Linux).
 */
import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from "electron";
import { LogFactory } from "@novel-master/core/log";
import type { ShellMenuId } from "../../shared/ipc-types.js";
import { DesktopDiagnostics } from "./log/desktop-diagnostics.js";

const log = LogFactory.create("desktop.shell-menu");

const isDev = !app.isPackaged;

let appMenu: Menu | null = null;

const TITLEBAR_OVERLAY = {
  light: { color: "#eef3fb", symbolColor: "#1a1d24" },
  dark: { color: "#14161a", symbolColor: "#f2f3f5" },
} as const;

const TITLEBAR_OVERLAY_HEIGHT = 40;

/** nm-style: keep-public — spec 4.6 要求的 deps 契约：installApplicationMenu 装配与模板测试共用同一份形状。 */
export interface ShellMenuDeps {
  readonly isDev: boolean;
  readonly onAbout: () => void;
  readonly onOpenLogsDir: () => void;
  readonly onExportDiagnostics: () => void;
}

export const ShellMenu = {
  /** Must be passed in BrowserWindow constructor on Windows — setTitleBarOverlay alone fails otherwise. */
  titleBarOverlayOptions(theme: "light" | "dark" = "light") {
    const palette = TITLEBAR_OVERLAY[theme];
    return {
      color: palette.color,
      symbolColor: palette.symbolColor,
      height: TITLEBAR_OVERLAY_HEIGHT,
    };
  },

  /** 菜单模板的外部动作；抽成纯函数是为了不碰 electron 就能断言结构与点击接线。 */
  // nm-style: keep-public — spec F3 明确要求可导出的纯模板函数，供测试不碰 Menu 直接断言。
  buildTemplate(deps: ShellMenuDeps): MenuItemConstructorOptions[] {
    return [
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
          ...(deps.isDev ? [{ role: "toggleDevTools" as const, label: "开发者工具" }] : []),
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
          { label: "打开日志目录", click: () => deps.onOpenLogsDir() },
          { label: "导出诊断包", click: () => deps.onExportDiagnostics() },
          { type: "separator" },
          { label: "关于 Novel Master", click: () => deps.onAbout() },
        ],
      },
    ];
  },

  // nm-style: keep-public — shell-menu 模块状态 appMenu 的唯一写入方（popupShellSubmenu 读取）；内联进 main.ts 需把模块状态外泄出本文件。
  installApplicationMenu(): void {
    // 原 buildApplicationMenu 内联：模板 + 模块状态 appMenu 的唯一写入点。
    const menu = Menu.buildFromTemplate(ShellMenu.buildTemplate({
      isDev,
      onAbout: () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;
        void dialog.showMessageBox(win, {
          type: "info",
          title: "关于",
          message: "Novel Master",
          detail: `版本 ${app.getVersion()}`,
        });
      },
      onOpenLogsDir: () => {
        void DesktopDiagnostics.openLogsDirectory(DesktopDiagnostics.createSeams()).catch((error: unknown) => log.error("open logs directory failed", { error }));
      },
      onExportDiagnostics: () => {
        void DesktopDiagnostics.export(DesktopDiagnostics.createSeams()).catch((error: unknown) => log.error("export diagnostics failed", { error }));
      },
    }));
    appMenu = menu;
    Menu.setApplicationMenu(menu);
  },

  // nm-style: keep-public — appMenu 模块状态的读取方（与 installApplicationMenu 写入配对）；内联进 IPC handler 需跨模块外泄状态。
  popupSubmenu(menuId: ShellMenuId, window: BrowserWindow, x: number, y: number): void {
    const item = appMenu?.getMenuItemById(menuId);
    const submenu = item?.submenu;
    if (!submenu) return;
    submenu.popup({ window, x: Math.round(x), y: Math.round(y) });
  },
} as const;
