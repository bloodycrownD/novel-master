/**
 * T-WP1：规则差集 → 仅对应 workplace attachment；再隐藏 → 投影空。
 * T-SR2b：发送 materialize 含 source:workplace；prepare hydrate 后 📄 chip 清空。
 * 顺带覆盖 user_ops path 形状与 replace（draft attach 恒空）预备 API。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  buildComposerStatusAttachments,
  projectComposerStatusAttachments,
  replaceComposerStatusAttachments,
} from "@/domain/chat/logic/project-composer-status-attachments.js";
import { userOpsAttachmentsFromSummaries } from "@/domain/chat/logic/build-user-ops-attachment.js";
import { workplaceAttachmentsFromRuleDelta } from "@/domain/workplace/logic/diff-workplace-paths.js";
import { prepareUserMessagesForPrompt } from "@/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { createSessionKkvService } from "@/service/session-kkv/create-session-kkv-service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

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
          action: "workplaceChange",
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
      { action: "write", path: "/ops.md" },
      { action: "write", path: "/other.md" },
    ]);

    assert.deepEqual(out, [
      {
        name: "/need.md",
        source: "workplace",
        type: "text",
        content: null,
        path: "/need.md",
        action: "workplaceChange",
      },
      {
        name: "/ops.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/ops.md",
        action: "write",
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
        source: "workplace" as const,
        type: "text" as const,
        content: null,
        path: "/new.md",
      },
    ];
    assert.deepEqual(
      replaceComposerStatusAttachments(existing, projected),
      projected,
    );
    assert.deepEqual(replaceComposerStatusAttachments(existing, []), []);
  });

  it("projectComposerStatusAttachments：组装 deps 并合并两侧", async () => {
    const out = await projectComposerStatusAttachments("sess-1", {
      sessionKkv: {
        listKeys: async () => [],
      },
      layout: { workplace: true },
      loadLiveWorkplacePaths: async () => [
        { path: "/w.md", status: "full" },
      ],
      previewUserOpsActions: async () => [
        { action: "write" as const, path: "/u.md" },
      ],
    });
    assert.deepEqual(out, [
      {
        name: "/w.md",
        source: "workplace",
        type: "text",
        content: null,
        path: "/w.md",
        action: "workplaceChange",
      },
      {
        name: "/u.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/u.md",
        action: "write",
      },
    ]);
  });

  it("A7: workplace=false → 无 workplace 状态 chip；user_ops 仍投影", async () => {
    let loadLiveCalled = false;
    let listKeysCalled = false;
    const out = await projectComposerStatusAttachments("sess-off", {
      sessionKkv: {
        listKeys: async () => {
          listKeysCalled = true;
          return [];
        },
      },
      layout: { workplace: false },
      loadLiveWorkplacePaths: async () => {
        loadLiveCalled = true;
        return [{ path: "/w.md", status: "full" }];
      },
      previewUserOpsActions: async () => [
        { action: "write" as const, path: "/u.md" },
      ],
    });
    assert.equal(loadLiveCalled, false, "关常驻不得 loadLiveWorkplacePaths");
    assert.equal(listKeysCalled, false, "关常驻不得读 file_cache keys");
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
      "关常驻不得投影 workplace chip",
    );
  });

  it("A7: layout.workplace 缺省 → 同 false，无 workplace chip", async () => {
    const out = await projectComposerStatusAttachments("sess-default", {
      sessionKkv: { listKeys: async () => [] },
      layout: {},
      loadLiveWorkplacePaths: async () => [
        { path: "/w.md", status: "full" },
      ],
      previewUserOpsActions: async () => [],
    });
    assert.deepEqual(out, []);
  });

  it("T-SR2b: 落库含 source:workplace；prepare hydrate 后 workplace chip 清空", async () => {
    // Given 规则差集出现 📄；When 发送 materialize 落库 + prepare 写 file_cache
    // Then 消息曾含 source:workplace，且差集投影不再产出 workplace chip
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/delta.md", "delta-body");
    const sk = createSessionKkvService(ctx.conn);
    const live = [{ path: "/delta.md", status: "full" as const }];

    const beforeChips = workplaceAttachmentsFromRuleDelta(live, []);
    assert.equal(beforeChips.length, 1);
    assert.equal(beforeChips[0]!.source, "workplace");
    assert.equal(beforeChips[0]!.path, "/delta.md");
    assert.deepEqual(
      buildComposerStatusAttachments(live, [], []),
      beforeChips,
    );

    // 模拟 materialize 落库（与 T-SR1 runAgentTurn 同源形状）
    const stored = await ctx.messages.append(
      session.id,
      "user",
      textBlocks(""),
      {
        attachments: [
          {
            name: "/delta.md",
            source: "workplace",
            type: "text",
            content: null,
            path: "/delta.md",
          },
        ],
      },
    );
    assert.ok(
      stored.attachments?.some(
        (a) => a.source === "workplace" && a.path === "/delta.md",
      ),
      "消息须含 source:workplace",
    );

    await prepareUserMessagesForPrompt([stored], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
    });
    const cacheKeys = await sk.listKeys(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
    );
    assert.ok(
      cacheKeys.includes(fileCacheKey("full", "/delta.md")),
      "prepare hydrate 须写 file_cache",
    );

    assert.deepEqual(
      workplaceAttachmentsFromRuleDelta(live, cacheKeys),
      [],
      "hydrate 后差集收敛，无 workplace chip",
    );
    assert.deepEqual(
      buildComposerStatusAttachments(live, cacheKeys, []),
      [],
      "projectComposerStatusAttachments 同源配方亦应清空 📄",
    );
    const projected = await projectComposerStatusAttachments(session.id, {
      sessionKkv: sk,
      layout: { workplace: true },
      loadLiveWorkplacePaths: async () => live,
      previewUserOpsActions: async () => [],
    });
    assert.equal(
      projected.filter((a) => a.source === "workplace").length,
      0,
      "发送成功+hydrate 后上条 📄 清空",
    );

    const reloaded = await ctx.messages.get(stored.id);
    assert.ok(
      reloaded?.attachments?.some(
        (a) => a.source === "workplace" && a.path === "/delta.md",
      ),
      "库内消息仍保留曾落库的 source:workplace",
    );
  });
});
