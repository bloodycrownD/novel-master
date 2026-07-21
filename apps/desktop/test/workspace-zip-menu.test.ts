import assert from "node:assert/strict";
import test from "node:test";
import {
  workspaceMenuItems,
  zipDirectoryPathForTarget,
  type WorkspaceContextTarget,
} from "@/features/workspace/workspace-context";
import type { WorkplaceListRowDto } from "@shared/ipc-types";

function blankTarget(): Extract<WorkspaceContextTarget, { kind: "blank" }> {
  return { kind: "blank", panelScope: "chat", x: 0, y: 0 };
}

function dirRow(path: string): WorkplaceListRowDto {
  return {
    path,
    kind: "dir",
    ruleState: "rule_off",
  };
}

function fileRow(path: string): WorkplaceListRowDto {
  return {
    path,
    kind: "file",
    inclusionMode: "auto",
    displayState: "full",
  };
}

test("T-Z9: blank 与域根目录行均有导入/导出 ZIP，directoryPath 均为 /", () => {
  const blank = blankTarget();
  const rootDir: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: dirRow("/"),
    x: 0,
    y: 0,
  };

  const blankActions = workspaceMenuItems(blank).map((i) => i.action);
  const rootActions = workspaceMenuItems(rootDir).map((i) => i.action);

  assert.ok(blankActions.includes("import-zip"));
  assert.ok(blankActions.includes("export-zip"));
  assert.ok(rootActions.includes("import-zip"));
  assert.ok(rootActions.includes("export-zip"));
  assert.equal(zipDirectoryPathForTarget(blank), "/");
  assert.equal(zipDirectoryPathForTarget(rootDir), "/");
});

test("T-Z9: 子目录 ZIP 目标为其 path；文件行无 ZIP 菜单", () => {
  const subDir: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: dirRow("/a"),
    x: 0,
    y: 0,
  };
  const file: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: fileRow("/a.md"),
    x: 0,
    y: 0,
  };

  assert.equal(zipDirectoryPathForTarget(subDir), "/a");
  const subActions = workspaceMenuItems(subDir).map((i) => i.action);
  assert.ok(subActions.includes("import-zip"));
  assert.ok(subActions.includes("export-zip"));

  assert.equal(zipDirectoryPathForTarget(file), null);
  const fileActions = workspaceMenuItems(file).map((i) => i.action);
  assert.ok(!fileActions.includes("import-zip"));
  assert.ok(!fileActions.includes("export-zip"));
});
