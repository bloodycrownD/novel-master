/**
 * T-PR1/T-PR2/T-PR3：增量协议统一与常驻前缀回归。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { wrapUserMessageForLlm } from "../../src/domain/chat/logic/wrap-user-message-for-llm.js";
import { renderFileBlockBody } from "../../src/domain/workplace/logic/workplace-display.js";
import { buildFileRefActionXml } from "../../src/domain/chat/logic/build-attachment-action-xml.js";
import { messageBodyText } from "../../src/domain/chat/content/message-body-text.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";
import {
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { serializeRuleSnapshot } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { createWorkplaceService } from "../../src/service/workplace/create-workplace-service.js";
import { assembleWorkplaceDisplay } from "../../src/service/workplace/assemble-workplace-display.js";
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
    id: "u1",
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

describe("prompt unify user-ops (T-PR*)", () => {
  it("T-PR1: 单一 <user-ops>；顺序 attach → workplace → user_ops；无内层三段标签", () => {
    const wrapped = wrapUserMessageForLlm("hi", [
      {
        name: "/w.md",
        source: "workplace",
        type: "text",
        content:
          '<action name="workplaceChange">\n{"path":"/w.md","content":"1|w","display":"full"}\n</action>',
        path: "/w.md",
        action: "workplaceChange",
      },
      {
        name: "/a.md",
        source: "attach",
        type: "text",
        content:
          '<action name="userAttach">\n{"path":"/a.md","content":"1|a","display":"full"}\n</action>',
        path: "/a.md",
        action: "userAttach",
      },
      {
        name: "/o.md",
        source: "user_ops",
        type: "text",
        content: '<action name="write">\n{"path":"/o.md","content":""}\n</action>',
        path: "/o.md",
        action: "write",
      },
      {
        name: "/c.md",
        source: "user_ops",
        type: "text",
        content:
          '<action name="annotate">\n{"path":"/c.md","originalText":"x","userAnnotation":"y"}\n</action>',
        path: "/c.md",
        action: "annotate",
      },
    ]);
    assert.match(wrapped, /<user-ops>/);
    assert.equal(wrapped.includes("<workplace>"), false);
    assert.equal(wrapped.includes("<attach>"), false);
    const iAttach = wrapped.indexOf('name="userAttach"');
    const iWp = wrapped.indexOf('name="workplaceChange"');
    const iWrite = wrapped.indexOf('name="write"');
    const iAnn = wrapped.indexOf('name="annotate"');
    assert.ok(iAttach >= 0 && iWp > iAttach && iWrite > iWp && iAnn > iWrite);
  });

  it("T-PR2: header 档 front-matter 行号正文；JSON 无 mtime/createdAt", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const body = "---\ntitle: x\n---\nhello";
    await vfs.write("/c.md", body);
    const sk = createSessionKkvService(ctx.conn);
    await sk.set(
      session.id,
      SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
      RULE_SNAPSHOT_CANON_KEY,
      serializeRuleSnapshot([{ path: "/c.md", status: "header" }]),
    );

    const lineBody = renderFileBlockBody({
      logicalPath: "/c.md",
      display: "header",
      content: body,
    });
    // 与常驻前缀同源：parseMarkdownFrontMatter 仅行号化 FM 正文行（不含 --- 定界符）
    assert.equal(lineBody, "1|title: x");

    const xml = buildFileRefActionXml({
      action: "workplaceChange",
      path: "/c.md",
      content: lineBody,
      display: "header",
    });
    assert.match(xml, /"display": "header"/);
    assert.equal(xml.includes("createdAt"), false);
    assert.equal(xml.includes("mtime"), false);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg(
          "hdr",
          [
            {
              name: "/c.md",
              source: "workplace",
              type: "text",
              content: null,
              path: "/c.md",
              action: "workplaceChange",
            },
          ],
          session.id,
        ),
      ],
      { sessionId: session.id, sessionKkv: sk, vfs },
    );
    const out = messageBodyText(prepared[0]!);
    assert.match(out, /<action name="workplaceChange">/);
    assert.match(out, /"display": "header"/);
    assert.equal(out.includes("<file "), false);
    assert.equal(out.includes("createdAt="), false);
  });

  it("T-PR3: 常驻前缀仍走 assembleWorkplaceDisplay（含 <file>），与增量协议无关", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/note.md", "prefix-body");
    await createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    }).setFileRule({ logicalPath: "/note.md", inclusionMode: "show" });

    const sk = createSessionKkvService(ctx.conn);
    const wt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    const out = await assembleWorkplaceDisplay(
      { kind: "session", projectId: project.id, sessionId: session.id },
      {
        sessionKkv: sk,
        workplace: wt,
        vfs,
        layout: {
          workplace: true,
          persist: [],
        },
      },
    );
    assert.ok(out.workplaceDisplay.includes("<file "));
    assert.ok(out.workplaceDisplay.includes("prefix-body"));
    assert.ok(out.workplaceDisplay.includes("createdAt="));
    assert.deepEqual(out.prefixPaths, ["/note.md"]);
  });
});
