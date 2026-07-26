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

test("T-C10: blank 与域根目录行均有「导入角色卡」，directoryPath 均为 /", () => {
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

  assert.ok(blankActions.includes("import-character-card"));
  assert.ok(rootActions.includes("import-character-card"));
  assert.equal(zipDirectoryPathForTarget(blank), "/");
  assert.equal(zipDirectoryPathForTarget(rootDir), "/");
});

test("T-C10: 子目录有「导入角色卡」；文件行无", () => {
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
  assert.ok(subActions.includes("import-character-card"));

  assert.equal(zipDirectoryPathForTarget(file), null);
  const fileActions = workspaceMenuItems(file).map((i) => i.action);
  assert.ok(!fileActions.includes("import-character-card"));
});
