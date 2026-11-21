/**
 * Application menu (accelerators + popup submenus for in-window menubar on Windows/Linux).
 */
import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from "electron";
import { LogFactory } from "@novel-master/core/log";
import type { ShellMenuId } from "../../shared/ipc-types.js";
import { DesktopDiagnostics } from "./log/desktop-diagnostics.js";
import { coreT } from "../../shared/logic/core-i18n.js";

const log = LogFactory.create("desktop.shell-menu");

const isDev = !app.isPackaged;

/** 应用菜单槽（模块内 holder，对象管理；installApplicationMenu 写入、popupShellSubmenu 读取）。 */
const menuSlot = {
  menu: null as Menu | null,
};

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
        label: coreT({key: "ui.menu.file"}),
        id: "file",
        submenu: [{ role: "quit", label: coreT({key: "ui.menu.quit"}) }],
      },
      {
        label: coreT({key: "ui.menu.edit"}),
        id: "edit",
        submenu: [
          { role: "undo", label: coreT({key: "ui.menu.undo"}) },
          { role: "redo", label: coreT({key: "ui.menu.redo"}) },
          { type: "separator" },
          { role: "cut", label: coreT({key: "ui.menu.cut"}) },
          { role: "copy", label: coreT({key: "ui.common.copy"}) },
          { role: "paste", label: coreT({key: "ui.common.paste"}) },
          { role: "selectAll", label: coreT({key: "ui.common.select_all"}) },
        ],
      },
      {
        label: coreT({key: "ui.menu.view"}),
        id: "view",
        submenu: [
          { role: "reload", label: coreT({key: "ui.menu.reload"}) },
          ...(deps.isDev ? [{ role: "toggleDevTools" as const, label: coreT({key: "ui.menu.dev_tools"}) }] : []),
          { type: "separator" },
          { role: "togglefullscreen", label: coreT({key: "ui.menu.fullscreen"}) },
        ],
      },
      {
        label: coreT({key: "ui.menu.window"}),
        id: "window",
        submenu: [
          { role: "minimize", label: coreT({key: "ui.menu.minimize"}) },
          { role: "close", label: coreT({key: "ui.menu.close_window"}) },
        ],
      },
      {
        label: coreT({key: "ui.menu.help"}),
        id: "help",
        submenu: [
          { label: coreT({key: "ui.menu.open_logs_dir"}), click: () => deps.onOpenLogsDir() },
          { label: coreT({key: "ui.menu.export_diagnostics"}), click: () => deps.onExportDiagnostics() },
          { type: "separator" },
          { label: coreT({key: "ui.nav.about"}), click: () => deps.onAbout() },
        ],
      },
    ];
  },

  // nm-style: keep-public — shell-menu 模块状态 menuSlot.menu 的唯一写入方（popupShellSubmenu 读取）；内联进 main.ts 需把模块状态外泄出本文件。
  installApplicationMenu(): void {
    // 原 buildApplicationMenu 内联：模板 + 模块状态 menuSlot.menu 的唯一写入点。
    const menu = Menu.buildFromTemplate(ShellMenu.buildTemplate({
      isDev,
      onAbout: () => {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return;
        void dialog.showMessageBox(win, {
          type: "info",
          title: coreT({key: "ui.menu.about"}),
          message: "Novel Master",
          detail: coreT({key: "ui.menu.version_line", params: {version: app.getVersion()}}),
        });
      },
      onOpenLogsDir: () => {
        void DesktopDiagnostics.openLogsDirectory(DesktopDiagnostics.createSeams()).catch((error: unknown) => log.error("open logs directory failed", { error }));
      },
      onExportDiagnostics: () => {
        void DesktopDiagnostics.export(DesktopDiagnostics.createSeams()).catch((error: unknown) => log.error("export diagnostics failed", { error }));
      },
    }));
    menuSlot.menu = menu;
    Menu.setApplicationMenu(menu);
  },

  // nm-style: keep-public — menuSlot.menu 模块状态的读取方（与 installApplicationMenu 写入配对）；内联进 IPC handler 需跨模块外泄状态。
  popupSubmenu(menuId: ShellMenuId, window: BrowserWindow, x: number, y: number): void {
    const item = menuSlot.menu?.getMenuItemById(menuId);
    const submenu = item?.submenu;
    if (!submenu) return;
    submenu.popup({ window, x: Math.round(x), y: Math.round(y) });
  },
} as const;
