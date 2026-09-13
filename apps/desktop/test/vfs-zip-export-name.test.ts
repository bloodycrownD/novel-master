/**
 * VFS ZIP 导出保存框默认名（T-E4）：真库直调 handleVfsZipExport，
 * 断言 VfsZipRequest.fileName 透传到 showSaveDialog defaultPath，
 * 且无覆盖时的命名规则与 mobile exportVfsZip 对齐：
 * fileName 覆盖 > 子目录末段 > 根目录项目名 > workspace.zip。
 *
 * dialog 走 electron-stub 同一引用改写；取消路径不触盘。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { dialog } from "electron";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleVfsZipExport } from "../src/main/ipc/handlers/vfs.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

function lastDialogOptions(): { defaultPath: string } {
  if (savedDialogs.length === 0) {
    throw new Error("showSaveDialog 未被调用");
  }
  const args = savedDialogs[savedDialogs.length - 1]!;
  return args[0] as { defaultPath: string };
}

const savedDialogs: unknown[][] = [];
const originalShowSaveDialog = dialog.showSaveDialog;

describe("handleVfsZipExport 保存框默认名", () => {
  let tempDir: string;
  let projectId: string;
  const projectName = "导出命名项目";

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-zip-name-"));
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      savedDialogs.push(args);
      return { canceled: true, filePath: undefined };
    }) as typeof dialog.showSaveDialog;

    const project = await handleProjectsCreate({ name: projectName });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;
  });

  after(async () => {
    dialog.showSaveDialog = originalShowSaveDialog;
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("fileName 覆盖透传到 dialog defaultPath", async () => {
    const res = await handleVfsZipExport({
      workspaceScope: "project-meta",
      projectId,
      fileName: "技能包.zip",
    });
    assert.equal(res.ok, true);
    assert.equal(res.data, "cancelled");
    assert.equal(lastDialogOptions().defaultPath, "技能包.zip");
  });

  it("无覆盖根目录用项目名（与 mobile 同规则）", async () => {
    const res = await handleVfsZipExport({
      workspaceScope: "project-meta",
      projectId,
    });
    assert.equal(res.ok, true);
    assert.equal(lastDialogOptions().defaultPath, `${projectName}.zip`);
  });

  it("子目录取末段（与 mobile 同规则）", async () => {
    const res = await handleVfsZipExport({
      workspaceScope: "project-meta",
      projectId,
      directoryPath: "/meta/skills/写作",
    });
    assert.equal(res.ok, true);
    assert.equal(lastDialogOptions().defaultPath, "写作.zip");
  });

  it("无 projectId 域根目录回退 workspace.zip", async () => {
    const res = await handleVfsZipExport({ workspaceScope: "global-meta" });
    assert.equal(res.ok, true);
    assert.equal(lastDialogOptions().defaultPath, "workspace.zip");
  });
});
