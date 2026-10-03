import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@shared/logic/workplace";
import { IPC_CHANNELS } from "@shared/ipc-types";
import {
  confirmSingleFileImport,
  createWorkspaceEntry,
  emptyDirRuleForm,
  defaultDirRuleRequest,
  deleteWorkspaceEntry,
  exportWorkspaceTarget,
  renameWorkspaceEntry,
  saveDirRule,
  startSingleFileImport,
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
 *
 * 记录每次调用的 channel + payload（`calls` 按调用顺序追加），供「走了哪条通道、
 * 带什么参数」断言用。既有调用方只传 respond 一参，行为完全不变。
 */
function installInvokeStub(
  respond: (channel: string, payload?: unknown) => Promise<unknown> | unknown,
): () => void;
function installInvokeStub(
  respond: (channel: string, payload?: unknown) => Promise<unknown> | unknown,
  calls: Array<{ channel: string; payload?: unknown }>,
): () => void;
function installInvokeStub(
  respond: (channel: string, payload?: unknown) => Promise<unknown> | unknown,
  calls: Array<{ channel: string; payload?: unknown }> = [],
): () => void {
  const g = globalThis as unknown as { window?: unknown };
  const prevWindow = g.window;
  g.window = {
    novelMasterDesktop: {
      invoke: (channel: string, payload?: unknown) => {
        calls.push({ channel, payload });
        return respond(channel, payload);
      },
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

/** 文件行 target（单文件导出分派用）。 */
function fileRowTarget(path = "/a/笔记.md"): WorkspaceContextTarget {
  return {
    kind: "row",
    panelScope: "chat",
    row: { kind: "file", path, inclusionMode: "auto", displayState: "full" },
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

test("createWorkspaceEntry（新建文件夹）NOT_FOUND 失败 → 中文文案", async () => {
  const restore = installInvokeStub((channel) => {
    assert.equal(channel, IPC_CHANNELS.VFS_MKDIR);
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Path not found: /新文件夹" },
    };
  });
  try {
    const outcome = await createWorkspaceEntry(
      { kind: "blank", panelScope: "chat", x: 0, y: 0 },
      "folder",
      "新文件夹",
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

test("renameWorkspaceEntry 未知错误码 → default 分支「操作失败：原因」", async () => {
  const restore = installInvokeStub((channel) => {
    assert.equal(channel, IPC_CHANNELS.VFS_RENAME);
    return {
      ok: false,
      error: { code: "SOMETHING", message: "x" },
    };
  });
  try {
    const outcome = await renameWorkspaceEntry(
      dirRowTarget(),
      "新名字",
      "p1",
      "s1",
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.message, "操作失败：x");
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

/* ── 单文件导入/导出编排（T-DI3 / T-DI4 / T-DI5）───────────────────────── */

const SCOPE = { workspaceScope: "chat", projectId: "p1", sessionId: "s1" } as const;

function appliedIngest() {
  return {
    ok: true,
    data: {
      status: "applied",
      report: { written: ["/notes/a.md"], skipped: [], failed: [] },
      skippedBinary: [],
    },
  };
}

/* T-DI3：导出按 row.kind 分流——文件行走 VFS_FILE_EXPORT，其余走 VFS_ZIP_EXPORT */

test("T-DI3 exportWorkspaceTarget 文件行 → VFS_FILE_EXPORT 且带 logicalPath", async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const restore = installInvokeStub(
    (channel) => {
      assert.equal(channel, IPC_CHANNELS.VFS_FILE_EXPORT);
      return { ok: true, data: "saved" };
    },
    calls,
  );
  try {
    const outcome = await exportWorkspaceTarget(SCOPE, fileRowTarget("/资料/笔记.md"));
    assert.equal(outcome, "saved");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.payload, {
      ...SCOPE,
      logicalPath: "/资料/笔记.md",
    });
  } finally {
    restore();
  }
});

test("T-DI3 exportWorkspaceTarget 目录行 → VFS_ZIP_EXPORT 且带 directoryPath", async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const restore = installInvokeStub(
    (channel) => {
      assert.equal(channel, IPC_CHANNELS.VFS_ZIP_EXPORT);
      return { ok: true, data: "cancelled" };
    },
    calls,
  );
  try {
    const outcome = await exportWorkspaceTarget(SCOPE, dirRowTarget("/资料"));
    assert.equal(outcome, "cancelled");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.payload, { ...SCOPE, directoryPath: "/资料" });
  } finally {
    restore();
  }
});

test("T-DI3 exportWorkspaceTarget 空白处 → VFS_ZIP_EXPORT 且 directoryPath 为根", async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const restore = installInvokeStub(
    (channel) => {
      assert.equal(channel, IPC_CHANNELS.VFS_ZIP_EXPORT);
      return { ok: true, data: "saved" };
    },
    calls,
  );
  try {
    const outcome = await exportWorkspaceTarget(SCOPE, {
      kind: "blank",
      panelScope: "chat",
      x: 0,
      y: 0,
    });
    assert.equal(outcome, "saved");
    assert.deepEqual(calls[0]!.payload, { ...SCOPE, directoryPath: "/" });
  } finally {
    restore();
  }
});

/* T-DI4：两段式——首段未确认覆盖拿 needs_confirm，次段同通道 overwriteConfirmed:true */

test("T-DI4 startSingleFileImport 冲突未确认 → needs-confirm（首段 overwriteConfirmed:false）", async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const restore = installInvokeStub(
    (channel, payload) => {
      if (channel === IPC_CHANNELS.VFS_FILE_PICK) {
        return { ok: true, data: "C:\\host\\a.md" };
      }
      assert.equal(channel, IPC_CHANNELS.VFS_BATCH_INGEST_FROM_PATHS);
      const req = payload as { overwriteConfirmed?: boolean };
      assert.equal(req.overwriteConfirmed, false);
      return {
        ok: true,
        data: {
          status: "needs_confirm",
          conflicts: [
            { logicalPath: "/notes/a.md", reason: "exists" },
            { logicalPath: "/notes/b.md", reason: "exists" },
          ],
          skippedBinary: [],
        },
      };
    },
    calls,
  );
  try {
    const outcome = await startSingleFileImport(SCOPE, "/notes");
    assert.equal(outcome.status, "needs-confirm");
    if (outcome.status !== "needs-confirm") {
      return;
    }
    assert.deepEqual(outcome.hostPaths, ["C:\\host\\a.md"]);
    assert.equal(outcome.conflictCount, 2);
    assert.deepEqual(
      calls.map((c) => c.channel),
      [IPC_CHANNELS.VFS_FILE_PICK, IPC_CHANNELS.VFS_BATCH_INGEST_FROM_PATHS],
    );
  } finally {
    restore();
  }
});

test("T-DI4 confirmSingleFileImport 同通道二次提交 overwriteConfirmed:true", async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const restore = installInvokeStub(
    (channel) => {
      assert.equal(channel, IPC_CHANNELS.VFS_BATCH_INGEST_FROM_PATHS);
      return appliedIngest();
    },
    calls,
  );
  try {
    const outcome = await confirmSingleFileImport(SCOPE, "/notes", [
      "C:\\host\\a.md",
    ]);
    assert.equal(outcome.status, "applied");
    assert.deepEqual(outcome.report.written, ["/notes/a.md"]);
    // 次段不重弹选择框：只有一次调用，且覆盖已确认
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.payload, {
      ...SCOPE,
      targetDir: "/notes",
      hostPaths: ["C:\\host\\a.md"],
      overwriteConfirmed: true,
    });
  } finally {
    restore();
  }
});

test("T-DI4 startSingleFileImport 无冲突 → 直接 applied（skippedBinary 透出供 toast）", async () => {
  const restore = installInvokeStub((channel) =>
    channel === IPC_CHANNELS.VFS_FILE_PICK
      ? { ok: true, data: "C:\\host\\a.md" }
      : {
          ok: true,
          data: {
            status: "applied",
            report: { written: ["/notes/a.md"], skipped: [], failed: [] },
            skippedBinary: ["b.bin"],
          },
        },
  );
  try {
    const outcome = await startSingleFileImport(SCOPE, "/notes");
    assert.equal(outcome.status, "applied");
    if (outcome.status !== "applied") {
      return;
    }
    assert.deepEqual(outcome.report.written, ["/notes/a.md"]);
    assert.deepEqual(outcome.skippedBinary, ["b.bin"]);
  } finally {
    restore();
  }
});

/* T-DI5：pick 取消 → 静默返回，零写入调用 */

test("T-DI5 startSingleFileImport pick 取消 → cancelled 且零写入调用", async () => {
  const calls: Array<{ channel: string; payload?: unknown }> = [];
  const restore = installInvokeStub(
    (channel) => {
      if (channel === IPC_CHANNELS.VFS_FILE_PICK) {
        return { ok: true, data: null };
      }
      throw new Error("取消后不应有任何写入类 IPC");
    },
    calls,
  );
  try {
    const outcome = await startSingleFileImport(SCOPE, "/notes");
    assert.deepEqual(outcome, { status: "cancelled" });
    assert.deepEqual(
      calls.map((c) => c.channel),
      [IPC_CHANNELS.VFS_FILE_PICK],
    );
  } finally {
    restore();
  }
});
