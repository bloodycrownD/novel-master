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

describe("SettingsViews agent delete confirm (T-AC3-4)", () => {
    it("单条删除确认仍使用显示名文案模式", () => {
        const source = readFileSync(settingsViewsPath, "utf8");
        // i18n 后锁 named 模板的 coreT 形态+键名+占位实参（显示名插值意图不变）。
        assert.match(
            source,
            /coreT\(\{key: "ui\.agent\.delete_agent_confirm_msg_named", params: \{name: deleteConfirm\?\.kind === "single" \? deleteConfirm\.name : ""\}\}\)/,
        );
        assert.match(
            source,
            /setDeleteConfirm\(\{\s*kind: "single",\s*agentId: row\.agentId,\s*name: row\.name,?\s*\}\)/,
        );
    });
});
