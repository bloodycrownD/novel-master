/**
 * T-WP1：规则差集 → 仅对应 workplace attachment；再隐藏 → 投影空。
 * 顺带覆盖 user_ops path 形状与 replace 预备 API。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileCacheKey } from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  buildComposerStatusAttachments,
  projectComposerStatusAttachments,
  replaceComposerStatusAttachments,
  userOpsAttachmentsFromChangedPaths,
} from "@/domain/chat/logic/project-composer-status-attachments.js";

describe("projectComposerStatusAttachments (T-WP1)", () => {
  it("T-WP1: 规则差集 → 仅对应 workplace；再隐藏 → 投影空", () => {
    const liveShown = [{ path: "/b.md", status: "full" as const }];
    const cacheKeys: string[] = [];

    assert.deepEqual(
      buildComposerStatusAttachments(liveShown, cacheKeys, []),
      [
        {
          name: "/b.md",
          source: "workplace",
          type: "text",
          content: null,
          path: "/b.md",
        },
      ],
    );

    // 改回隐藏：live 不再含该 path
    assert.deepEqual(
      buildComposerStatusAttachments([], cacheKeys, []),
      [],
    );
  });

  it("T-WP1: cache 已加载则 workplace 不再出现；user_ops 按 path 各一条", () => {
    const live = [
      { path: "/cached.md", status: "full" as const },
      { path: "/need.md", status: "full" as const },
    ];
    const cacheKeys = [fileCacheKey("full", "/cached.md")];
    const out = buildComposerStatusAttachments(live, cacheKeys, [
      "/ops.md",
      "/other.md",
    ]);

    assert.deepEqual(out, [
      {
        name: "/need.md",
        source: "workplace",
        type: "text",
        content: null,
        path: "/need.md",
      },
      {
        name: "/ops.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/ops.md",
      },
      {
        name: "/other.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/other.md",
      },
    ]);
  });

  it("userOpsAttachmentsFromChangedPaths：name/path=该 path，content null", () => {
    assert.deepEqual(userOpsAttachmentsFromChangedPaths(["/a.md"]), [
      {
        name: "/a.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/a.md",
      },
    ]);
  });

  it("replaceComposerStatusAttachments：整表替换状态类，保留 attach", () => {
    const existing = [
      {
        name: "/old.md",
        source: "workplace" as const,
        type: "text" as const,
        content: null,
        path: "/old.md",
      },
      {
        name: "edit",
        source: "user_ops" as const,
        type: "text" as const,
        content: null,
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
        source: "workplace" as const,
        type: "text" as const,
        content: null,
        path: "/new.md",
      },
    ];
    assert.deepEqual(
      replaceComposerStatusAttachments(existing, projected),
      [
        ...projected,
        {
          name: "/ref.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/ref.md",
        },
      ],
    );
    assert.deepEqual(replaceComposerStatusAttachments(existing, []), [
      {
        name: "/ref.md",
        source: "attach",
        type: "text",
        content: null,
        path: "/ref.md",
      },
    ]);
  });

  it("projectComposerStatusAttachments：组装 deps 并合并两侧", async () => {
    const out = await projectComposerStatusAttachments("sess-1", {
      sessionKkv: {
        listKeys: async () => [],
      },
      loadLiveWorkplacePaths: async () => [
        { path: "/w.md", status: "full" },
      ],
      previewUserOpsChangedPaths: async () => ["/u.md"],
    });
    assert.deepEqual(out, [
      {
        name: "/w.md",
        source: "workplace",
        type: "text",
        content: null,
        path: "/w.md",
      },
      {
        name: "/u.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/u.md",
      },
    ]);
  });
});
