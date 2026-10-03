import assert from "node:assert/strict";
import test from "node:test";
import {
  characterCardImportConfirmMessage,
  exportFilePathForTarget,
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

test("T-C10: blank 与域根目录行均有「导入」（角色卡走弹窗二选），directoryPath 均为 /", () => {
  const blank = blankTarget();
  const rootDir: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: dirRow("/"),
    x: 0,
    y: 0,
  };

  const blankItems = workspaceMenuItems(blank);
  const rootItems = workspaceMenuItems(rootDir);

  for (const items of [blankItems, rootItems]) {
    const actions = items.map((i) => i.action);
    assert.ok(actions.includes("import"));
    // 角色卡不再是独立菜单项，收敛进「导入」弹窗（不再有 import-character-card）。
    assert.ok(!actions.includes("import-character-card"));
    assert.ok(!actions.includes("import-zip"));
    assert.ok(!actions.includes("export-zip"));
    assert.equal(actions.filter((a) => a === "import").length, 1);
    assert.equal(actions.length, new Set(actions).size, "action 不得重复");
  }

  assert.equal(
    blankItems.find((i) => i.action === "import")?.label,
    "导入",
  );
  assert.equal(
    rootItems.find((i) => i.action === "import")?.label,
    "导入",
  );

  assert.equal(zipDirectoryPathForTarget(blank), "/");
  assert.equal(zipDirectoryPathForTarget(rootDir), "/");
});

test("T-C10: 子目录有「导入」；文件行无「导入」但有单文件「导出」", () => {
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
  assert.ok(subActions.includes("import"));
  assert.ok(!subActions.includes("import-character-card"));

  const fileActions = workspaceMenuItems(file).map((i) => i.action);
  assert.ok(!fileActions.includes("import"));
  assert.ok(!fileActions.includes("import-character-card"));
  assert.ok(fileActions.includes("export"));

  assert.equal(zipDirectoryPathForTarget(file), null);
  assert.equal(exportFilePathForTarget(file), "/a.md");
  assert.equal(exportFilePathForTarget(subDir), null);
  assert.equal(exportFilePathForTarget(blankTarget()), null);
});

test("T-DM4: 角色卡确认文案自洽且与 ZIP 文案不同源", () => {
  const root = characterCardImportConfirmMessage("/");
  const sub = characterCardImportConfirmMessage("/a");

  assert.notEqual(root, sub);
  assert.ok(sub.includes("/a"));
  assert.ok(root.includes("工作区根"));
});