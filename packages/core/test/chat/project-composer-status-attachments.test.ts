/**
 * T-CR2（投影半边）：状态条仅 user_ops；不产出 source:workplace。
 * 顺带覆盖 replace（draft attach 恒空）预备 API。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildComposerStatusAttachments,
  projectComposerStatusAttachments,
  replaceComposerStatusAttachments,
} from "@/domain/chat/logic/project-composer-status-attachments.js";
import { userOpsAttachmentsFromSummaries } from "@/domain/chat/logic/build-user-ops-attachment.js";

describe("projectComposerStatusAttachments (T-CR2 ops-only)", () => {
  it("T-CR2: 仅 user_ops；空摘要 → 投影空（无 workplace 半边）", () => {
    assert.deepEqual(buildComposerStatusAttachments([]), []);
  });

  it("T-CR2: user_ops 按 path 各一条；不混入 workplace", () => {
    const out = buildComposerStatusAttachments([
      { action: "write", path: "/ops.md" },
      { action: "mkdir", path: "/dir" },
      { action: "write", path: "/other.md" },
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

  it("userOpsAttachmentsFromSummaries：path → user_ops attachment", () => {
    assert.deepEqual(
      userOpsAttachmentsFromSummaries([{ action: "write", path: "/a.md" }]),
      [
        {
          name: "/a.md",
          source: "user_ops",
          type: "text",
          content: null,
          path: "/a.md",
          action: "write",
        },
      ],
    );
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

  it("projectComposerStatusAttachments：仅组装 user_ops", async () => {
    const out = await projectComposerStatusAttachments("sess-1", {
      previewUserOpsActions: async () => [
        { action: "write" as const, path: "/u.md" },
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

  it("preview 空 → 投影空", async () => {
    const out = await projectComposerStatusAttachments("sess-empty", {
      previewUserOpsActions: async () => [],
    });
    assert.deepEqual(out, []);
  });
});
