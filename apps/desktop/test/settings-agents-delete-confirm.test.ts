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
    assert.match(
      source,
      /删除 Agent「\$\{\s*deleteConfirm\?\.kind === "single" \? deleteConfirm\.name : ""\s*\}」？/,
    );
    assert.match(
      source,
      /setDeleteConfirm\(\{\s*kind: "single",\s*agentId: row\.agentId,\s*name: row\.name,?\s*\}\)/,
    );
  });
});
