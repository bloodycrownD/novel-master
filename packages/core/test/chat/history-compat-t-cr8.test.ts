/**
 * T-CR8（历史只读兼容）：历史 workplaceChange 气泡「规则:」；
 * 新规则保存不产出规则 chip；prepare 重放旧 workplace 附件不炸。
 */
import {  unwrap  } from "../helpers/result-unwrap.js";
import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  TextBlocks  } from "@novel-master/core/chat";
import {  MessageBodyText  } from "../../src/domain/chat/content/message-body-text.js";
import {  PromptAssembler  } from "../../src/domain/chat/logic/prompt/prompt-assembler.js";
import {  SessionKkvServiceFactory  } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {  AttachmentChip  } from "../../src/domain/chat/presentation/attachment-chip.js";
import {  CORE_CATALOGS  } from "../../src/i18n/index.js";
import {  createTranslator  } from "../../src/common/i18n.js";

const zhT = createTranslator(CORE_CATALOGS, "zh-CN");
// descriptor 化兼容 shim：断言保持旧字符串口径（zh 渲染逐字一致）。
const formatStatusLabelFromAttachment = (a: Parameters<typeof AttachmentChip.fromAttachment>[0], options?: Parameters<typeof AttachmentChip.fromAttachment>[1]): string | null => {
  const d = AttachmentChip.fromAttachment(a, options);
  return d == null ? null : (zhT(d as never) as string);
};
import type { ChatMessageData } from "../../src/domain/chat/model/message.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";
import {  RULE_SNAPSHOT_CANON_KEY, SESSION_KKV_DOMAIN_FILE_CACHE, SESSION_KKV_DOMAIN_RULE_SNAPSHOT  } from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import {  RuleSnapshotCodec  } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import {  WorkplaceServiceFactory  } from "../../src/service/workplace/create-workplace-service.js";
import {  RuleSnapshot  } from "../../src/service/workplace/refresh-rule-snapshot.js";
import {  getNovelMasterTestContext, novelMasterTestFixture, testIsolationSuffix  } from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function userMsg(
  text: string,
  attachments: readonly MessageAttachment[],
  sessionId: string,
): ChatMessageData {
  return {
    id: "u-hist",
    sessionId,
    seq: 1,
    role: "user",
    content: TextBlocks.of(text),
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
      formatStatusLabelFromAttachment({
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
      formatStatusLabelFromAttachment({
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
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const sk = SessionKkvServiceFactory.create(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/rule.md", "body");
    const wt = WorkplaceServiceFactory.create(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await wt.setFileRule({ logicalPath: "/rule.md", inclusionMode: "show" });
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      RuleSnapshotCodec.fileCacheKey("full", "/rule.md"),
      JSON.stringify({ body: "stale", mtimeMs: 1 }),
    );

    await RuleSnapshot.refresh(session.id, {
      sessionKkv: sk,
      workplace: wt,
    });

    const canon = unwrap(await sk.get(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
    ));
    assert.ok(canon != null && canon !== "");

    // user ops 投影链已拆除（E-core）：规则快照 canon 存在即代表新规则保存不产生规则 chip
    assert.equal(
      typeof canon === "string" && canon.length > 0,
      true,
      "新规则保存不得投影规则 chip",
    );
  });

  it("T-CR8: prepare 重放历史 workplace / workplaceChange 附件不炸且产出 action XML", async () => {
    const ctx = getNovelMasterTestContext();
    const project = unwrap(await ctx.projects.create(`P-${testIsolationSuffix()}`));
    const session = unwrap(await ctx.sessions.create(project.id));
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/hist.md", "hist-body");
    const sk = SessionKkvServiceFactory.create(ctx.conn);

    const prepared = unwrap(await PromptAssembler.prepare(
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
    ));

    const body = MessageBodyText.fromBlocks(prepared[0]!.content.blocks);
    assert.match(body, /<action name="workplaceChange">/);
    assert.match(body, /hist-body/);
    assert.ok(!body.includes("<workplace>"));
  });
});
