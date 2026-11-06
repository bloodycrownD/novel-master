/**
 * 菜单模板纯函数：帮助子菜单含「打开日志目录」「导出诊断包」，点击接到注入动作。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MenuItemConstructorOptions } from "electron";
import { buildMenuTemplate } from "../src/main/shell-menu.js";

function helpItems(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const help = template.find((item) => item.id === "help");
  assert.ok(help != null, "帮助菜单必须存在");
  assert.ok(Array.isArray(help.submenu), "帮助子菜单必须是模板数组");
  return help.submenu as MenuItemConstructorOptions[];
}

describe("buildMenuTemplate", () => {
  it("帮助子菜单含打开日志目录 / 导出诊断包 / 关于，且排在关于之前", () => {
    const items = helpItems(buildMenuTemplate({ isDev: true, onAbout: () => {}, onOpenLogsDir: () => {}, onExportDiagnostics: () => {} }));
    const labels = items.map((item) => item.label);
    assert.ok(labels.includes("打开日志目录"));
    assert.ok(labels.includes("导出诊断包"));
    assert.ok(labels.indexOf("打开日志目录") < labels.indexOf("关于 Novel Master"));
    assert.ok(labels.indexOf("导出诊断包") < labels.indexOf("关于 Novel Master"));
  });

  it("点击菜单项调到注入的 onOpenLogsDir / onExportDiagnostics", () => {
    const calls: string[] = [];
    const items = helpItems(
      buildMenuTemplate({
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
    click("打开日志目录");
    click("导出诊断包");
    click("关于 Novel Master");
    assert.deepEqual(calls, ["open-logs", "export", "about"]);
  });

  it("isDev 控制开发者工具项", () => {
    const devItems = buildMenuTemplate({ isDev: true, onAbout: () => {}, onOpenLogsDir: () => {}, onExportDiagnostics: () => {} });
    const prodItems = buildMenuTemplate({ isDev: false, onAbout: () => {}, onOpenLogsDir: () => {}, onExportDiagnostics: () => {} });
    const viewLabels = (template: MenuItemConstructorOptions[]): Array<string | undefined> =>
      (template.find((item) => item.id === "view")?.submenu as MenuItemConstructorOptions[]).map((item) => item.label);
    assert.ok(viewLabels(devItems).includes("开发者工具"));
    assert.ok(!viewLabels(prodItems).includes("开发者工具"));
  });
});
