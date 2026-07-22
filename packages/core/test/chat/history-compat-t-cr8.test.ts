/**
 * T-CR8（历史只读兼容）：历史 workplaceChange 气泡「规则:」；
 * 新规则保存不产出规则 chip；prepare 重放旧 workplace 附件不炸。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { messageBodyText } from "../../src/domain/chat/content/message-body-text.js";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { projectComposerStatusAttachments } from "../../src/domain/chat/logic/project-composer-status-attachments.js";
import { formatStatusChipLabelFromAttachment } from "../../src/domain/chat/logic/status-chip-label.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";
import {
  fileCacheKey,
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { createWorkplaceService } from "../../src/service/workplace/create-workplace-service.js";
import { refreshRuleSnapshot } from "../../src/service/workplace/refresh-rule-snapshot.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function userMsg(
  text: string,
  attachments: readonly MessageAttachment[],
  sessionId: string,
): ChatMessage {
  return {
    id: "u-hist",
    sessionId,
    seq: 1,
    role: "user",
    content: textBlocks(text),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
    attachments,
  };
}

describe("history workplaceChange compat (T-CR8)", () => {
  it("T-CR8: 历史 workplaceChange / source:workplace 气泡文案仍为「规则:path」", () => {
    assert.equal(
      formatStatusChipLabelFromAttachment({
        action: "workplaceChange",
        path: "/legacy.md",
        name: "/legacy.md",
        source: "workplace",
        content: null,
      }),
      "规则:/legacy.md",
    );
    // 无 action 的旧落库形态
    assert.equal(
      formatStatusChipLabelFromAttachment({
        source: "workplace",
        name: "/old.md",
        path: "/old.md",
        content: null,
      }),
      "规则:/old.md",
    );
  });

  it("T-CR8: 新会话规则保存（refreshRuleSnapshot）后投影无规则 chip", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/rule.md", "body");
    const wt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await wt.setFileRule({ logicalPath: "/rule.md", inclusionMode: "show" });
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/rule.md"),
      JSON.stringify({ body: "stale", mtimeMs: 1 }),
    );

    await refreshRuleSnapshot(session.id, {
      sessionKkv: sk,
      workplace: wt,
    });

    const canon = await sk.get(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
    );
    assert.ok(canon != null && canon !== "");

    const chips = await projectComposerStatusAttachments(session.id, {
      previewUserOpsActions: async () => [],
    });
    assert.deepEqual(chips, []);
    assert.equal(
      chips.some((a) => a.source === "workplace" || a.action === "workplaceChange"),
      false,
      "新规则保存不得投影规则 chip",
    );
  });

  it("T-CR8: prepare 重放历史 workplace / workplaceChange 附件不炸且产出 action XML", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/hist.md", "hist-body");
    const sk = createSessionKkvService(ctx.conn);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg(
          "回放",
          [
            {
              name: "/hist.md",
              source: "workplace",
              type: "text",
              content: null,
              path: "/hist.md",
              action: "workplaceChange",
            },
          ],
          session.id,
        ),
      ],
      { sessionId: session.id, sessionKkv: sk, vfs },
    );

    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<action name="workplaceChange">/);
    assert.match(body, /hist-body/);
    assert.ok(!body.includes("<workplace>"));
  });
});
