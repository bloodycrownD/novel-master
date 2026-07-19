/**
 * Step 5：attachments_json + MessageService.append round-trip。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import type { MessageAttachment } from "../../src/domain/chat/model/message.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("message attachments round-trip (Step 5)", () => {
  it("append + list 读写 attachments_json；缺附件为 undefined", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);

    const plain = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("hello"),
    );
    assert.equal(plain.attachments, undefined);

    const attachments: MessageAttachment[] = [
      {
        name: "/notes/a.md",
        source: "attach",
        type: "text",
        content: null,
        path: "/notes/a.md",
      },
      {
        name: "ops",
        source: "user_ops",
        type: "text",
        content: `<action name="write">\n{"path":"/x.md","content":""}\n</action>`,
      },
    ];
    const withAtt = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("你好"),
      { attachments },
    );
    assert.equal(withAtt.content.blocks[0]?.type, "text");
    if (withAtt.content.blocks[0]?.type === "text") {
      assert.equal(withAtt.content.blocks[0].text, "你好");
      assert.equal(withAtt.content.blocks[0].text.includes("<attachment>"), false);
    }
    assert.deepEqual(withAtt.attachments, attachments);

    const listed = await ctx.messages.listBySession(session.id);
    const reloaded = listed.find((m) => m.id === withAtt.id);
    assert.ok(reloaded);
    assert.deepEqual(reloaded!.attachments, attachments);
    assert.equal(
      reloaded!.content.blocks[0]?.type === "text"
        ? reloaded!.content.blocks[0].text
        : "",
      "你好",
    );

    const byId = await ctx.messages.get(withAtt.id);
    assert.deepEqual(byId.attachments, attachments);
  });

  it("fork 保留 attachments", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const attachments: MessageAttachment[] = [
      {
        name: "/a.md",
        source: "workplace",
        type: "text",
        content: null,
        path: "/a.md",
      },
    ];
    const msg = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("body"),
      { attachments },
    );
    const forked = await ctx.messages.fork(session.id, msg.id);
    const forkedMessages = await ctx.messages.listBySession(forked.id);
    assert.equal(forkedMessages.length, 1);
    assert.deepEqual(forkedMessages[0]!.attachments, attachments);
  });

  it("updateContent 保留 attachments_json（P2）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const attachments: MessageAttachment[] = [
      {
        name: "/a.md",
        source: "attach",
        type: "text",
        content: null,
        path: "/a.md",
      },
    ];
    const msg = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("old"),
      { attachments },
    );
    const updated = await ctx.messages.updateContent(
      msg.id,
      textBlocks("new"),
    );
    assert.equal(
      updated.content.blocks[0]?.type === "text"
        ? updated.content.blocks[0].text
        : "",
      "new",
    );
    assert.deepEqual(updated.attachments, attachments);
  });
});
