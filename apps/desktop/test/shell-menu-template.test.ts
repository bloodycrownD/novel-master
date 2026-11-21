/**
 * 菜单模板纯函数：帮助子菜单含「打开日志目录」「导出诊断包」，点击接到注入动作。
 *
 * 文案锚经 coreT 取键值（i18n 迁移后源码不再硬编码中文；结构+接线意图不变）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MenuItemConstructorOptions } from "electron";
import { ShellMenu } from "../src/main/shell-menu.js";
import { coreT } from "../shared/logic/core-i18n.js";

const LOGS_LABEL = coreT({key: "ui.menu.open_logs_dir"});
const EXPORT_LABEL = coreT({key: "ui.menu.export_diagnostics"});
const ABOUT_LABEL = coreT({key: "ui.nav.about"});
const DEVTOOLS_LABEL = coreT({key: "ui.menu.dev_tools"});

function helpItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const help = template.find((item) => item.id === "help");
  assert.ok(help != null, "帮助菜单必须存在");
  assert.ok(Array.isArray(help.submenu), "帮助子菜单必须是模板数组");
  return help.submenu as MenuItemConstructorOptions[];
}

describe("buildMenuTemplate", () => {
  it("帮助子菜单含打开日志目录 / 导出诊断包 / 关于，且排在关于之前", () => {
    const items = helpItems(ShellMenu.buildTemplate({ isDev: true, onAbout: () => {}, onOpenLogsDir: () => {}, onExportDiagnostics: () => {} }));
    const labels = items.map((item) => item.label);
    assert.ok(labels.includes(LOGS_LABEL));
    assert.ok(labels.includes(EXPORT_LABEL));
    assert.ok(labels.indexOf(LOGS_LABEL) < labels.indexOf(ABOUT_LABEL));
    assert.ok(labels.indexOf(EXPORT_LABEL) < labels.indexOf(ABOUT_LABEL));
  });

  it("点击菜单项调到注入的 onOpenLogsDir / onExportDiagnostics", () => {
    const calls: string[] = [];
    const items = helpItems(
      ShellMenu.buildTemplate({
        isDev: true,
        onAbout: () => calls.push("about"),
        onOpenLogsDir: () => calls.push("open-logs"),
        onExportDiagnostics: () => calls.push("export"),
      }),
    );
    const click = (label: string): void => {
      const handler = items.find((item) => item.label === label)?.click as (() => void) | undefined;
      assert.ok(handler != null, `菜单项 ${label} 必须有 click`);
      handler();
    };
    click(LOGS_LABEL);
    click(EXPORT_LABEL);
    click(ABOUT_LABEL);
    assert.deepEqual(calls, ["open-logs", "export", "about"]);
  });

  it("isDev 控制开发者工具项", () => {
    const devItems = ShellMenu.buildTemplate({ isDev: true, onAbout: () => {}, onOpenLogsDir: () => {}, onExportDiagnostics: () => {} });
    const prodItems = ShellMenu.buildTemplate({ isDev: false, onAbout: () => {}, onOpenLogsDir: () => {}, onExportDiagnostics: () => {} });
    const viewLabels = (template: MenuItemConstructorOptions[]): Array<string | undefined> =>
      (template.find((item) => item.id === "view")?.submenu as MenuItemConstructorOptions[]).map((item) => item.label);
    assert.ok(viewLabels(devItems).includes(DEVTOOLS_LABEL));
    assert.ok(!viewLabels(prodItems).includes(DEVTOOLS_LABEL));
  });
});
