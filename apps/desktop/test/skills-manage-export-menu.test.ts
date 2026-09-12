/**
 * 技能管理页「导出 ZIP」入口（T-E5）：源码级断言（照 workspace-zip-menu 模式）。
 * 菜单项位于「编辑」后「删除」前；调用契约与 NewSkillModal 导入链对称：
 * workspaceScope global-meta/project-meta + projectId + directoryPath /meta/skills/{name}
 * + fileName {name}.zip。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const source = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/features/settings/SkillsManageView.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("SkillsManageView 导出 ZIP 入口（源码断言）", () => {
  it("行菜单含「导出 ZIP」，排在编辑后、删除前", () => {
    const exportIdx = source.indexOf('{ label: "导出 ZIP", action: "export-zip" }');
    const editIdx = source.indexOf('{ label: "编辑", action: "edit" }');
    const deleteIdx = source.indexOf('{ label: "删除", action: "delete", danger: true }');
    assert.ok(exportIdx > 0, "缺少「导出 ZIP」菜单项");
    assert.ok(editIdx > 0 && editIdx < exportIdx, "导出应排在编辑之后");
    assert.ok(deleteIdx > exportIdx, "导出应排在删除之前");
  });

  it("导出分支调 ipcVfsZipExport 并附 fileName 与技能目录", () => {
    assert.ok(source.includes("ipcVfsZipExport({"));
    assert.ok(
      source.includes(
        'current.ref.domain === "global" ? "global-meta" : "project-meta"',
      ),
      "workspaceScope 应按技能域映射 global-meta/project-meta",
    );
    assert.ok(
      source.includes("projectId: current.ref.projectId"),
      "project 域应携带 projectId",
    );
    assert.ok(
      source.includes("directoryPath: `/meta/skills/${current.ref.name}`"),
      "directoryPath 应指向技能目录",
    );
    assert.ok(
      source.includes("fileName: `${current.ref.name}.zip`"),
      "fileName 应为 {技能名}.zip",
    );
  });
});
