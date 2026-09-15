import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@shared/logic/workplace";
import { IPC_CHANNELS } from "@shared/ipc-types";
import {
  emptyDirRuleForm,
  defaultDirRuleRequest,
  deleteWorkspaceEntry,
  renameWorkspaceEntry,
  saveDirRule,
} from "@/features/workspace/workspace-actions";
import type { WorkspaceContextTarget } from "@/features/workspace/workspace-context";

test("emptyDirRuleForm 无持久化规则时 ruleEnabled 为 false", () => {
  const form = emptyDirRuleForm("/notes", {
    workspaceScope: "chat",
    projectId: "p1",
    sessionId: "s1",
  });
  assert.equal(form.ruleEnabled, false);
  assert.equal(form.logicalPath, "/notes");
  assert.equal(form.fillPolicy, DEFAULT_WORKPLACE_DIR_RULE.fillPolicy);
});

test("defaultDirRuleRequest 新建目录持久化时 ruleEnabled 为 true", () => {
  const form = defaultDirRuleRequest("/drafts", {
    workspaceScope: "chat",
    projectId: "p1",
    sessionId: "s1",
  });
  assert.equal(form.ruleEnabled, true);
  assert.equal(form.logicalPath, "/drafts");
});

/**
 * 往 globalThis.window 注入 novelMasterDesktop.invoke stub（仿
 * workspace-push-menu.test.tsx 的先例）：按 channel 分派预设 IPC 应答。
 */
function installInvokeStub(
  respond: (channel: string) => Promise<unknown> | unknown,
): () => void {
  const g = globalThis as unknown as { window?: unknown };
  const prevWindow = g.window;
  g.window = {
    novelMasterDesktop: {
      invoke: (channel: string) => respond(channel),
    },
  };
  return () => {
    g.window = prevWindow;
  };
}

/** 目录行 target（rename/delete 动作入参）。 */
function dirRowTarget(path = "/a"): WorkspaceContextTarget {
  return {
    kind: "row",
    panelScope: "chat",
    row: { kind: "dir", path, ruleState: "rule_on" },
    x: 0,
    y: 0,
  };
}

test("renameWorkspaceEntry NOT_FOUND 失败 → 中文文案", async () => {
  const restore = installInvokeStub(() => ({
    ok: false,
    error: { code: "NOT_FOUND", message: "Path not found: /a" },
  }));
  try {
    const outcome = await renameWorkspaceEntry(
      dirRowTarget(),
      "新名字",
      "p1",
      "s1",
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.message, "文件不存在或已被删除。");
    }
  } finally {
    restore();
  }
});

test("renameWorkspaceEntry ALREADY_EXISTS 失败 → 名称不能重复（对齐 mobile）", async () => {
  const restore = installInvokeStub(() => ({
    ok: false,
    error: { code: "ALREADY_EXISTS", message: "Path already exists: /a" },
  }));
  try {
    const outcome = await renameWorkspaceEntry(
      dirRowTarget(),
      "新名字",
      "p1",
      "s1",
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.message, "名称不能重复");
    }
  } finally {
    restore();
  }
});

test("deleteWorkspaceEntry NOT_FOUND 失败 → 中文文案", async () => {
  const restore = installInvokeStub(() => ({
    ok: false,
    error: { code: "NOT_FOUND", message: "Path not found: /a" },
  }));
  try {
    const outcome = await deleteWorkspaceEntry(dirRowTarget(), "p1", "s1");
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.message, "文件不存在或已被删除。");
    }
  } finally {
    restore();
  }
});

test("saveDirRule（非 VFS 动作）失败保持原文案，不走中文映射", async () => {
  const restore = installInvokeStub((channel) => {
    assert.equal(channel, IPC_CHANNELS.WORKPLACE_SET_DIR_RULE);
    return {
      ok: false,
      error: { code: "VALIDATION", message: "规则保存失败原文案" },
    };
  });
  try {
    const outcome = await saveDirRule({
      workspaceScope: "chat",
      projectId: "p1",
      sessionId: "s1",
      logicalPath: "/a",
      ruleEnabled: true,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.message, "规则保存失败原文案");
    }
  } finally {
    restore();
  }
});
