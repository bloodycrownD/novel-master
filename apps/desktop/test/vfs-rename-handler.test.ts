/**
 * handleVfsRename：目录 rename 后迁移 workplace 规则（desktop-rename-ghost-dir）。
 *
 * - project 面板 scope（workspaceScope "session" → core project 域）走直调分支；
 * - chat 面板 scope（workspaceScope "chat" → core session 域，统一 tool turn
 *   默认开启）走 executeSessionUserVfsOp 分支，kind 须在 execute 前判定；
 * - 文件 rename 不迁移规则（与 mobile 口径一致）的对照断言。
 * 仿 vfs-delete-handler.test.ts 的 setupDesktopDbTestEnv + 直调 handler 模式。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import {
  handleVfsMkdir,
  handleVfsRename,
  handleVfsWrite,
} from "../src/main/ipc/handlers/vfs.js";
import {
  handleWorkplaceBuildListRows,
  handleWorkplaceGetDirRule,
  handleWorkplaceSetDirRule,
  handleWorkplaceSetFileRule,
} from "../src/main/ipc/handlers/workplace.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/** 与默认规则全字段不同的可辨识排序配置，用于断言迁移后原配置保留。 */
const DISTINCT_RULE = {
  sortField: "updated" as const,
  sortOrder: "desc" as const,
  headCount: 3,
  tailCount: 7,
  fillPolicy: "hidden" as const,
};

async function setDirRuleWithDistinctConfig(
  scope: { workspaceScope: "session" | "chat"; projectId: string; sessionId?: string },
  logicalPath: string,
): Promise<void> {
  const result = await handleWorkplaceSetDirRule({
    ...scope,
    logicalPath,
    ...DISTINCT_RULE,
    ruleEnabled: true,
  });
  assert.equal(result.ok, true);
}

describe("handleVfsRename 目录迁移 workplace 规则", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-vfs-rename-"));

    const project = await handleProjectsCreate({ name: "vfs-rename-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下 session 创建要求 workspace 已配置 agent。
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await handleAgentSetCurrent({ agentId: blank.data.agentId });
    }

    const session = await handleSessionsCreate({
      projectId,
      title: "vfs-rename-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("project 面板 scope：目录 rename 后规则迁移到新路径且保留原配置", async () => {
    const scope = { workspaceScope: "session" as const, projectId };
    await handleVfsMkdir({ ...scope, path: "/旧项目目录" });
    await handleVfsMkdir({ ...scope, path: "/旧项目目录/子目录" });
    await setDirRuleWithDistinctConfig(scope, "/旧项目目录");
    await setDirRuleWithDistinctConfig(scope, "/旧项目目录/子目录");

    const result = await handleVfsRename({
      ...scope,
      oldPath: "/旧项目目录",
      newPath: "/新项目目录",
    });
    assert.equal(result.ok, true);

    // 旧路径规则应不存在（rename 语义不留旧行，否则残留渲染成幽灵目录）
    const oldRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/旧项目目录",
    });
    assert.equal(oldRule.ok && oldRule.data == null, true);

    // 新路径规则存在且保留可辨识配置
    const newRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/新项目目录",
    });
    assert.ok(newRule.ok && newRule.data != null);
    assert.equal(newRule.data.ruleEnabled, true);
    assert.equal(newRule.data.sortField, DISTINCT_RULE.sortField);
    assert.equal(newRule.data.sortOrder, DISTINCT_RULE.sortOrder);
    assert.equal(newRule.data.headCount, DISTINCT_RULE.headCount);
    assert.equal(newRule.data.tailCount, DISTINCT_RULE.tailCount);
    assert.equal(newRule.data.fillPolicy, DISTINCT_RULE.fillPolicy);

    // 子目录规则随前缀一起批量迁移
    const subRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/新项目目录/子目录",
    });
    assert.ok(subRule.ok && subRule.data != null);
    assert.equal(subRule.data.sortField, DISTINCT_RULE.sortField);

    // VFS 侧条目确实换到了新路径
    const rt = await getDesktopRuntime();
    const entries = await rt.projectVfs(projectId).list("/");
    assert.ok(entries.some((e) => e.path === "/新项目目录"));
    assert.ok(!entries.some((e) => e.path === "/旧项目目录"));
  });

  it("chat 面板 scope（session 分支）：目录 rename 后规则同样迁移", async () => {
    const scope = {
      workspaceScope: "chat" as const,
      projectId,
      sessionId,
    };
    const mkdirResult = await handleVfsMkdir({
      ...scope,
      path: "/旧会话目录",
    });
    assert.equal(mkdirResult.ok, true);
    // 目录内放一个文件，覆盖「带子项的目录」rename 场景；
    // 纯空目录 rename core 已支持（read 以 IS_DIRECTORY 判目录，
    // 不再依赖子项列表），专项断言见下方空目录用例
    const writeResult = await handleVfsWrite({
      ...scope,
      path: "/旧会话目录/内容.md",
      content: "c",
    });
    assert.equal(writeResult.ok, true);
    await setDirRuleWithDistinctConfig(scope, "/旧会话目录");

    const result = await handleVfsRename({
      ...scope,
      oldPath: "/旧会话目录",
      newPath: "/新会话目录",
    });
    assert.equal(result.ok, true);

    const oldRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/旧会话目录",
    });
    assert.equal(oldRule.ok && oldRule.data == null, true);

    const newRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/新会话目录",
    });
    assert.ok(newRule.ok && newRule.data != null);
    assert.equal(newRule.data.sortField, DISTINCT_RULE.sortField);
    assert.equal(newRule.data.sortOrder, DISTINCT_RULE.sortOrder);

    const rt = await getDesktopRuntime();
    const entries = await rt.sessionVfs(projectId, sessionId).list("/");
    assert.ok(entries.some((e) => e.path === "/新会话目录"));
    assert.ok(!entries.some((e) => e.path === "/旧会话目录"));
  });

  it("chat 面板 scope（session 分支）：纯空目录 rename 同样成功且规则迁移", async () => {
    const scope = {
      workspaceScope: "chat" as const,
      projectId,
      sessionId,
    };
    // core 已支持空目录 rename：read 以 IS_DIRECTORY 判目录，不再因
    // 「无子项」误报 NOT_FOUND；session 分支（executeSessionUserVfsOp →
    // fs mv → moveVfsPath）与 project 分支共用该能力
    const mkdirResult = await handleVfsMkdir({
      ...scope,
      path: "/空会话目录",
    });
    assert.equal(mkdirResult.ok, true);
    await setDirRuleWithDistinctConfig(scope, "/空会话目录");

    const result = await handleVfsRename({
      ...scope,
      oldPath: "/空会话目录",
      newPath: "/改名空会话目录",
    });
    assert.equal(result.ok, true, "空目录 rename 应成功而非 NOT_FOUND");

    const oldRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/空会话目录",
    });
    assert.equal(oldRule.ok && oldRule.data == null, true);

    const newRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/改名空会话目录",
    });
    assert.ok(newRule.ok && newRule.data != null);
    assert.equal(newRule.data.sortField, DISTINCT_RULE.sortField);
    assert.equal(newRule.data.sortOrder, DISTINCT_RULE.sortOrder);

    const rt = await getDesktopRuntime();
    const entries = await rt.sessionVfs(projectId, sessionId).list("/");
    assert.ok(entries.some((e) => e.path === "/改名空会话目录"));
    assert.ok(!entries.some((e) => e.path === "/空会话目录"));
  });

  it("project 面板 scope（对照）：纯空目录 rename 同样成功且规则迁移", async () => {
    const scope = { workspaceScope: "session" as const, projectId };
    const mkdirResult = await handleVfsMkdir({
      ...scope,
      path: "/空项目目录",
    });
    assert.equal(mkdirResult.ok, true);
    await setDirRuleWithDistinctConfig(scope, "/空项目目录");

    const result = await handleVfsRename({
      ...scope,
      oldPath: "/空项目目录",
      newPath: "/改名空项目目录",
    });
    assert.equal(result.ok, true, "空目录 rename 应成功而非 NOT_FOUND");

    const oldRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/空项目目录",
    });
    assert.equal(oldRule.ok && oldRule.data == null, true);

    const newRule = await handleWorkplaceGetDirRule({
      ...scope,
      logicalPath: "/改名空项目目录",
    });
    assert.ok(newRule.ok && newRule.data != null);
    assert.equal(newRule.data.sortField, DISTINCT_RULE.sortField);

    const rt = await getDesktopRuntime();
    const entries = await rt.projectVfs(projectId).list("/");
    assert.ok(entries.some((e) => e.path === "/改名空项目目录"));
    assert.ok(!entries.some((e) => e.path === "/空项目目录"));
  });

  it("文件 rename 不迁移规则（对照）：fileRule 留在旧路径", async () => {
    const scope = {
      workspaceScope: "chat" as const,
      projectId,
      sessionId,
    };
    const write = await handleVfsWrite({
      ...scope,
      path: "/对照文件.md",
      content: "content",
    });
    assert.equal(write.ok, true);
    const fileRule = await handleWorkplaceSetFileRule({
      ...scope,
      logicalPath: "/对照文件.md",
      inclusionMode: "hide",
    });
    assert.equal(fileRule.ok, true);

    const result = await handleVfsRename({
      ...scope,
      oldPath: "/对照文件.md",
      newPath: "/改名文件.md",
    });
    assert.equal(result.ok, true);

    // 规则未跟随文件迁移：列表里新路径行不受旧 hide 规则影响（mobile 同口径）
    const rows = await handleWorkplaceBuildListRows(scope);
    assert.ok(rows.ok);
    const renamed = rows.data.find(
      (r) => r.kind === "file" && r.path === "/改名文件.md",
    );
    assert.ok(renamed != null, "rename 后新路径文件应在列表中");
    if (renamed.kind === "file") {
      assert.notEqual(renamed.inclusionMode, "hide");
    }
  });
});
