import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  batchIngestOverwriteMessage,
  characterCardImportConfirmMessage,
  exportFilePathForTarget,
  workspaceMenuItems,
  zipDirectoryPathForTarget,
  zipImportConfirmMessage,
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

/** 收敛后被退役的三个 action——任何分支都不该再出现。 */
const RETIRED_ACTIONS = ["import-zip", "import-character-card", "export-zip"];

test("T-DM1: blank 与域根目录行菜单收敛为「导入」「导出」两项", () => {
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
    assert.ok(actions.includes("export"));
    for (const retired of RETIRED_ACTIONS) {
      assert.ok(!actions.includes(retired), `不应残留 ${retired}`);
    }
    // 含且仅含：import / export 各恰好一项，label 也钉住，避免后续再加重复项。
    assert.equal(actions.filter((a) => a === "import").length, 1);
    assert.equal(actions.filter((a) => a === "export").length, 1);
    assert.equal(actions.length, new Set(actions).size, "action 不得重复");
  }

  // label 断言 + 「含且仅含」数量：blank 分支共四项（原为五项）。
  assert.deepEqual(
    blankItems.map((i) => i.label),
    ["新建文件", "新建文件夹", "导入", "导出"],
  );
  // 目录行在「导入/导出」之外还有规则配置与增删改名，共七项。
  assert.deepEqual(
    rootItems.map((i) => i.label),
    ["新建文件", "新建文件夹", "导入", "导出", "规则配置", "重命名", "删除文件夹"],
  );
  assert.equal(rootItems.at(-1)?.danger, true);

  assert.equal(zipDirectoryPathForTarget(blank), "/");
  assert.equal(zipDirectoryPathForTarget(rootDir), "/");
});

test("T-DM1: 子目录菜单同样含 import/export 且不含旧三项", () => {
  const subDir: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: dirRow("/a"),
    x: 0,
    y: 0,
  };

  const actions = workspaceMenuItems(subDir).map((i) => i.action);
  assert.ok(actions.includes("import"));
  assert.ok(actions.includes("export"));
  for (const retired of RETIRED_ACTIONS) {
    assert.ok(!actions.includes(retired), `不应残留 ${retired}`);
  }
  assert.equal(zipDirectoryPathForTarget(subDir), "/a");
});

test("T-DM2: 文件行菜单含「导出」不含「导入」，导出目标为其自身路径", () => {
  const file: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: fileRow("/a.md"),
    x: 0,
    y: 0,
  };
  const subDir: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: dirRow("/a"),
    x: 0,
    y: 0,
  };

  const items = workspaceMenuItems(file);
  const actions = items.map((i) => i.action);
  // 语义翻转：收敛后文件行**有** export（原断言是「无 export-zip」）。
  assert.ok(actions.includes("export"));
  assert.ok(!actions.includes("import"));
  assert.equal(actions.filter((a) => a === "export").length, 1);
  assert.equal(actions.length, new Set(actions).size, "action 不得重复");
  assert.deepEqual(
    items.map((i) => i.label),
    ["状态设置", "导出", "重命名", "删除文件"],
  );

  // 单文件导出目标：文件行 = row.path；目录行与空白处无单文件导出。
  assert.equal(exportFilePathForTarget(file), "/a.md");
  assert.equal(exportFilePathForTarget(subDir), null);
  assert.equal(exportFilePathForTarget(blankTarget()), null);
});

test("T-DM3: zipDirectoryPathForTarget 三分支语义不变", () => {
  const file: WorkspaceContextTarget = {
    kind: "row",
    panelScope: "chat",
    row: fileRow("/a.md"),
    x: 0,
    y: 0,
  };

  assert.equal(zipDirectoryPathForTarget(blankTarget()), "/");
  assert.equal(
    zipDirectoryPathForTarget({
      kind: "row",
      panelScope: "chat",
      row: dirRow("/a"),
      x: 0,
      y: 0,
    }),
    "/a",
  );
  assert.equal(zipDirectoryPathForTarget(file), null);
});

test("T-DM4: ZIP 与角色卡覆盖确认文案独立，批量覆盖文案含冲突数", () => {
  const rootZip = zipImportConfirmMessage("/");
  const subZip = zipImportConfirmMessage("/a");
  const rootCard = characterCardImportConfirmMessage("/");
  const subCard = characterCardImportConfirmMessage("/a");

  // 拆成两条独立文案：同名目录下两者输出必须不同，否则等于没拆。
  assert.notEqual(rootZip, rootCard);
  assert.notEqual(subZip, subCard);
  assert.ok(subZip.includes("/a"));
  assert.ok(subCard.includes("/a"));
  // ZIP 讲「目录全部内容」，角色卡讲「写入目标目录」，语义提示词各自到位。
  assert.ok(rootZip.includes("全部文件"));
  assert.ok(rootCard.includes("角色卡"));

  const message = batchIngestOverwriteMessage(3);
  assert.ok(message.includes("3"));
  assert.equal(batchIngestOverwriteMessage(0).includes("3"), false);
});

/**
 * T-DM5: 导出 toast 文案按分流来源分家（源码断言，desktop/C-3）。
 *
 * 为什么是源码断言：desktop 测试不 import App.tsx（整棵树要不起），组件层断言拿不到。
 * 契约点只有一条——「已导出文件」与「已导出 ZIP」两句锚必须同时存在于 App.tsx，
 * 防止任一分支退化成共用的「已导出」（用户就分辨不出落盘的是 zip 还是单文件）。
 */
test("T-DM5: 导出 toast 文案按 file / zip 分流，两句锚并存", () => {
  const appSource = readFileSync(
    fileURLToPath(new URL("../renderer/App.tsx", import.meta.url)),
    "utf8",
  );
  assert.ok(
    appSource.includes("已导出文件"),
    "缺少单文件导出的 toast 文案锚",
  );
  assert.ok(appSource.includes("已导出 ZIP"), "缺少 ZIP 导出的 toast 文案锚");
  // 共用的退化文案不该再出现（'已导出 ZIP' / '已导出文件' 是子串，按带引号的整句查）。
  assert.ok(
    !appSource.includes("showToast('已导出')"),
    "不应退化成不分流的共用「已导出」",
  );
  // 文案与分流来源绑在一起：判定用的正是 exportFilePathForTarget（文件行非 null）。
  assert.ok(
    appSource.includes("exportFilePathForTarget(target) == null"),
    "toast 文案应按 exportFilePathForTarget 的分流结果选取",
  );
});
