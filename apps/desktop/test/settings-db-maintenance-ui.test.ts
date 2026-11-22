import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsViewsPath = path.join(
    __dirname,
    "..",
    "renderer",
    "features",
    "settings",
    "SettingsViews.tsx",
);

/** 提取函数源码片段（从声明行到函数体收尾的 `};`）；闭合锚对缩进空白归一（缩进基线 2→4 不可再破坏断言）。 */
function extractFunction(source: string, name: string): string {
    const start = source.indexOf(`const ${name} = async () => {`);
    assert.ok(start >= 0, `${name} 未找到`);
    const rest = source.slice(start);
    const closeAt = /\n +};/.exec(rest)?.index ?? -1;
    assert.ok(closeAt > 0, `${name} 函数体未闭合`);
    return rest.slice(0, closeAt);
}

describe("SettingsViews 数据清理 UI（T-UID1）", () => {
    const source = readFileSync(settingsViewsPath, "utf8");

    it("数据清理分区展示库体积与可回收量，失败回退占位 '—'", () => {
        // i18n 后锁 coreT 调用形态+键名+占位实参（失败回退 "—" 的意图由 params 实参保持）。
        assert.match(source, /title=\{coreT\(\{key: "ui\.storage\.cleanup_section"\}\)\}/);
        assert.match(
            source,
            /desc=\{coreT\(\{key: "ui\.storage\.cleanup_desktop_desc", params: \{before: dbStats \? formatStorageBytes\(dbStats\.fileBytes\) : "—", after: dbStats \? formatStorageBytes\(dbStats\.reclaimableBytes\) : "—"\}\}\)\}/,
        );
    });

    it("清理按钮挂 ConfirmModal 二次确认", () => {
        // 清理按钮文案按 3c-a 裁决接 ui.storage.cleanup_action（清理数据库空间）。
        assert.match(
            source,
            /onClick=\{\(\) => setConfirmMaintenance\(true\)\}\s*\n\s*>\s*\n\s*\{coreT\(\{key: "ui\.storage\.cleanup_action"\}\)\}/,
        );
        assert.match(source, /open=\{confirmMaintenance\}/);
        // 确认弹窗 title 与 message（正文「耗时随库体积增长」语义）i18n 后锁 coreT 形态+键名。
        assert.match(source, /title=\{coreT\(\{key: "ui\.storage\.cleanup_confirm_title_desktop"\}\)\}/);
        assert.match(source, /message=\{coreT\(\{key: "ui\.storage\.cleanup_confirm_desktop"\}\)\}/);
        assert.match(
            source,
            /onConfirm=\{\(\) => void runMaintenance\(\)\}/,
        );
    });

    it("controlsDisabled 纳入 maintenanceBusy", () => {
        assert.match(
            source,
            /const busyFlags = \[\s*status\?\.syncBusy,\s*status\?\.agentActive,\s*status\?\.maintenanceBusy,\s*\];/,
        );
        assert.match(source, /const controlsDisabled = busy \|\| busyFlags\.some/);
    });

    it("执行前置 busy：setBusy(true) 先于 invoke ipcDbMaintenance", () => {
        const body = extractFunction(source, "runMaintenance");
        const busyAt = body.indexOf("setBusy(true)");
        const invokeAt = body.indexOf("await ipcDbMaintenance({ runId })");
        assert.ok(busyAt >= 0, "runMaintenance 内未找到 setBusy(true)");
        assert.ok(invokeAt > busyAt, "setBusy(true) 必须在 invoke 之前");
    });

    it("结果反馈：成功含前后体积对比，失败走 toastSettingsError", () => {
        const body = extractFunction(source, "runMaintenance");
        assert.match(
            body,
            /formatStorageBytes\(res\.data\.beforeBytes\)/,
        );
        assert.match(
            body,
            /formatStorageBytes\(res\.data\.afterBytes\)/,
        );
        assert.match(body, /toastSettingsError\(res\.error\.message\)/);
    });
});
