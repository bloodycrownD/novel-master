/**
 * T-CR2（投影半边）：状态条仅 user_ops（读 log store）；不产出 source:workplace。
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  buildComposerStatusAttachments,
  projectComposerStatusAttachments,
  replaceComposerStatusAttachments,
} from "@/domain/chat/logic/project-composer-status-attachments.js";
import { resetUserOpsLogStoreForTests } from "@/domain/chat/logic/chat-user-ops-log-store.js";
import type { UserOpsLogEntry } from "@/domain/chat/model/user-ops-log.schema.js";

beforeEach(() => {
  resetUserOpsLogStoreForTests();
});

function entry(
  partial: Pick<UserOpsLogEntry, "action"> &
    Partial<UserOpsLogEntry> & { path?: string; newPath?: string },
): UserOpsLogEntry {
  const id = partial.id ?? `uol-${Math.random().toString(36).slice(2, 8)}`;
  const createdAtMs = partial.createdAtMs ?? 1;
  const actionXml = partial.actionXml ?? `<action name="${partial.action}"></action>`;
  if (partial.action === "rename") {
    return {
      id,
      createdAtMs,
      actionXml,
      action: "rename",
      oldPath: (partial as { oldPath?: string }).oldPath ?? "/from",
      newPath: partial.newPath ?? "/to",
    };
  }
  if (partial.action === "edit") {
    return {
      id,
      createdAtMs,
      actionXml,
      action: "edit",
      path: partial.path ?? "/e.md",
      hunks: [{ oldString: "a", newString: "b" }],
    };
  }
  if (partial.action === "mkdir") {
    return {
      id,
      createdAtMs,
      actionXml,
      action: "mkdir",
      path: partial.path ?? "/dir",
    };
  }
  if (partial.action === "delete") {
    return {
      id,
      createdAtMs,
      actionXml,
      action: "delete",
      path: partial.path ?? "/d.md",
    };
  }
  return {
    id,
    createdAtMs,
    actionXml,
    action: "write",
    path: partial.path ?? "/w.md",
    content: "",
  };
}

describe("projectComposerStatusAttachments (T-CR2 ops-only / log store)", () => {
  it("T-CR2/T-CR8: 仅 user_ops；空日志 → 投影空", () => {
    assert.deepEqual(buildComposerStatusAttachments([]), []);
  });

  it("T-CR2: user_ops 按 path 各一条；不混入 workplace", () => {
    const out = buildComposerStatusAttachments([
      entry({ action: "write", path: "/ops.md" }),
      entry({ action: "mkdir", path: "/dir" }),
      entry({ action: "write", path: "/other.md" }),
    ]);

    assert.deepEqual(out, [
      {
        name: "/ops.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/ops.md",
        action: "write",
      },
      {
        name: "/dir",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/dir",
        action: "mkdir",
      },
      {
        name: "/other.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/other.md",
        action: "write",
      },
    ]);
    assert.equal(
      out.some((a) => a.source === "workplace"),
      false,
      "投影不得含 source:workplace",
    );
  });

  it("T-UOL6 投影：同 path 两条 → 一颗 chip，action 取最后一条", () => {
    const out = buildComposerStatusAttachments([
      entry({ action: "write", path: "/same.md", actionXml: "<action name=\"write\"></action>" }),
      entry({
        action: "edit",
        path: "/same.md",
        actionXml: "<action name=\"edit\"></action>",
      }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.path, "/same.md");
    assert.equal(out[0]!.action, "edit");
  });

  it("replaceComposerStatusAttachments：整表替换为投影，不保留 attach", () => {
    const existing = [
      {
        name: "/old.md",
        source: "workplace" as const,
        type: "text" as const,
        content: null,
        path: "/old.md",
      },
      {
        name: "/x.md",
        source: "user_ops" as const,
        type: "text" as const,
        content: null,
        path: "/x.md",
      },
      {
        name: "/ref.md",
        source: "attach" as const,
        type: "text" as const,
        content: null,
        path: "/ref.md",
      },
    ];
    const projected = [
      {
        name: "/new.md",
        source: "user_ops" as const,
        type: "text" as const,
        content: null,
        path: "/new.md",
        action: "write" as const,
      },
    ];
    assert.deepEqual(
      replaceComposerStatusAttachments(existing, projected),
      projected,
    );
    assert.deepEqual(replaceComposerStatusAttachments(existing, []), []);
  });

  it("projectComposerStatusAttachments：读 listUserOpsLogEntries", async () => {
    const out = await projectComposerStatusAttachments("sess-1", {
      listUserOpsLogEntries: () => [
        entry({ action: "write", path: "/u.md" }),
      ],
    });
    assert.deepEqual(out, [
      {
        name: "/u.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/u.md",
        action: "write",
      },
    ]);
    assert.equal(
      out.some((a) => a.source === "workplace"),
      false,
    );
  });

  it("空日志 → 投影空", async () => {
    const out = await projectComposerStatusAttachments("sess-empty", {
      listUserOpsLogEntries: () => [],
    });
    assert.deepEqual(out, []);
  });
});
