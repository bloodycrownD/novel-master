/**
 * 单文件导入/导出的 main 侧行为（T-DI1 / T-DI2）。
 *
 * 直调 handler（仿 vfs-zip-export-name.test.ts 的模式）：dialog 走 electron-stub
 * 同一引用改写，不真弹框；导出写盘落在临时目录，测完由 teardown 清掉。
 *
 * 覆盖：
 * - pick：取消 → null；选中 → 原样回绝对路径（不读字节、不做 UTF-8 判定，
 *   那道关在 core 的 planBatchIngest/skippedBinary）。
 * - export：保存框默认名 = 文件名；取消 → cancelled；写盘 utf8 且内容一致；
 *   误传目录（plan 出多条）→ 报错且**不弹保存框**（这条是安全闸回归）。
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { dialog } from "electron";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import {
  handleVfsFileExport,
  handleVfsFilePick,
  handleVfsMkdir,
  handleVfsWrite,
} from "../src/main/ipc/handlers/vfs.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

const openDialogs: unknown[][] = [];
const saveDialogs: unknown[][] = [];
const originalShowOpenDialog = dialog.showOpenDialog;
const originalShowSaveDialog = dialog.showSaveDialog;

type OpenDialogStub = (result: {
  canceled: boolean;
  filePaths: string[];
}) => void;
type SaveDialogStub = (result: {
  canceled: boolean;
  filePath?: string;
}) => void;

/** 临时改写 open/save dialog（同一 electron-stub 引用，与生产同路径）。 */
function stubOpenDialog(set: OpenDialogStub): void {
  dialog.showOpenDialog = (async (...args: unknown[]) => {
    openDialogs.push(args);
    // 默认取消；set 只改字段不改引用，所以是 const 而不是 let。
    const result = { canceled: true, filePaths: [] as string[] };
    set(result);
    return result;
  }) as typeof dialog.showOpenDialog;
}

function stubSaveDialog(set: SaveDialogStub): void {
  dialog.showSaveDialog = (async (...args: unknown[]) => {
    saveDialogs.push(args);
    const result: { canceled: boolean; filePath?: string } = { canceled: true };
    set(result);
    return result;
  }) as typeof dialog.showSaveDialog;
}

function lastSaveDialogOptions(): { defaultPath?: string } {
  if (saveDialogs.length === 0) {
    throw new Error("showSaveDialog 未被调用");
  }
  // 有 parentWindow 时首参是 window，options 在第二参；无窗时 options 就是首参。
  const args = saveDialogs[saveDialogs.length - 1]!;
  return (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string };
}

describe("VFS 单文件 pick / export（T-DI1 / T-DI2）", () => {
  let tempDir: string;
  let projectId: string;
  let scope: { workspaceScope: "session"; projectId: string };

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-file-io-"));
    const project = await handleProjectsCreate({ name: "单文件导出项目" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;
    scope = { workspaceScope: "session", projectId };
  });

  after(async () => {
    dialog.showOpenDialog = originalShowOpenDialog;
    dialog.showSaveDialog = originalShowSaveDialog;
    await teardownDesktopDbTestEnv(tempDir);
  });

  beforeEach(() => {
    openDialogs.length = 0;
    saveDialogs.length = 0;
    dialog.showOpenDialog = originalShowOpenDialog;
    dialog.showSaveDialog = originalShowSaveDialog;
  });

  it("T-DI1 pick：用户取消 → null", async () => {
    stubOpenDialog(() => undefined);
    const res = await handleVfsFilePick();
    assert.equal(res.ok, true);
    assert.equal(res.data, null);
    assert.equal(openDialogs.length, 1);
  });

  it("T-DI1 pick：选中 → 原样返回绝对路径（不判 UTF-8、不传 filters）", async () => {
    const picked = join(tempDir, "任意名称.unknownext");
    stubOpenDialog((result) => {
      result.canceled = false;
      result.filePaths = [picked];
    });
    const res = await handleVfsFilePick();
    assert.equal(res.ok, true);
    assert.equal(res.data, picked);

    // 不传 filters：VFS 内容不限扩展名，白名单只会把无扩展名文件挡在门外。
    const opts = (openDialogs[0]!.length > 1
      ? openDialogs[0]![1]
      : openDialogs[0]![0]) as { filters?: unknown };
    assert.equal(opts.filters, undefined);
  });

  it("T-DI1 pick：canceled=false 但未选任何文件 → null", async () => {
    stubOpenDialog((result) => {
      result.canceled = false;
      result.filePaths = [];
    });
    const res = await handleVfsFilePick();
    assert.equal(res.ok, true);
    assert.equal(res.data, null);
  });

  it("T-DI2 export：默认名 = 文件名；取消保存框 → cancelled 且不写盘", async () => {
    await handleVfsWrite({ ...scope, path: "/笔记/导出.md", content: "hello" });
    const before = saveDialogs.length;
    stubSaveDialog(() => undefined);
    const res = await handleVfsFileExport({ ...scope, logicalPath: "/笔记/导出.md" });
    assert.equal(res.ok, true);
    assert.equal(res.data, "cancelled");
    assert.equal(saveDialogs.length, before + 1);
    assert.equal(lastSaveDialogOptions().defaultPath, "导出.md");
  });

  it("T-DI2 export：保存 → utf8 写盘且内容与 VFS 一致", async () => {
    const content = "第一行\n中文内容\n";
    await handleVfsWrite({ ...scope, path: "/笔记/落盘.md", content });
    const target = join(tempDir, "落盘-out.md");
    stubSaveDialog((result) => {
      result.canceled = false;
      result.filePath = target;
    });

    const res = await handleVfsFileExport({ ...scope, logicalPath: "/笔记/落盘.md" });
    assert.equal(res.ok, true);
    assert.equal(res.data, "saved");
    assert.equal(lastSaveDialogOptions().defaultPath, "落盘.md");
    assert.equal(await readFile(target, "utf8"), content);
  });

  it("T-DI2 export：顶层文件同样取文件名作默认名", async () => {
    await handleVfsWrite({ ...scope, path: "/顶层.md", content: "x" });
    stubSaveDialog(() => undefined);
    const res = await handleVfsFileExport({ ...scope, logicalPath: "/顶层.md" });
    assert.equal(res.ok, true);
    assert.equal(lastSaveDialogOptions().defaultPath, "顶层.md");
  });

  it("T-DI2 export：误传目录（plan 出多条）→ 报错，且不弹保存框、不写盘", async () => {
    await handleVfsMkdir({ ...scope, path: "/多文件目录" });
    await handleVfsWrite({ ...scope, path: "/多文件目录/a.md", content: "a" });
    await handleVfsWrite({ ...scope, path: "/多文件目录/b.md", content: "b" });

    // 这条是安全闸：`planBatchExport` 收到目录会递归整棵子树且**不报错**，
    // 只取 files[0] 会静默把「导出一个目录」降级成「导出其中某个文件」。
    const target = join(tempDir, "不应写出.md");
    await writeFile(target, "原内容", "utf8");
    stubSaveDialog((result) => {
      result.canceled = false;
      result.filePath = target;
    });

    const res = await handleVfsFileExport({ ...scope, logicalPath: "/多文件目录" });
    assert.equal(res.ok, false);
    assert.match(res.ok ? "" : res.error.message, /只能导出单个文件/);
    assert.equal(saveDialogs.length, 0, "校验必须发生在 showSaveDialog 之前");
    assert.equal(await readFile(target, "utf8"), "原内容");
  });

  it("T-DI2 export：不存在的路径 → 报错（files 为空 ≠ 1）", async () => {
    stubSaveDialog((result) => {
      result.canceled = false;
      result.filePath = join(tempDir, "不存在.md");
    });
    const res = await handleVfsFileExport({ ...scope, logicalPath: "/根本没有这个.md" });
    assert.equal(res.ok, false);
    assert.equal(saveDialogs.length, 0);
  });
});
