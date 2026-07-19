/**
 * MessageAttachment zod wire 单测（含 T-SCH1）。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NO_PATH_ATTACHMENT_NAME,
  attachmentStorageName,
  messageAttachmentSchema,
  parseAttachmentsJson,
  serializeAttachmentsJson,
} from "../../src/domain/chat/model/message-attachment.schema.js";

describe("messageAttachmentSchema", () => {
  it("accepts workplace/attach/user_ops 合法条目", () => {
    const att = messageAttachmentSchema.parse({
      name: "/a.md",
      source: "attach",
      type: "text",
      content: null,
      path: "/a.md",
      action: "userAttach",
    });
    assert.equal(att.source, "attach");
    assert.equal(att.action, "userAttach");
  });

  it("T-SCH1: 新附件 action+path，name===path；空 path → __no_path__；禁 write:/ 展示 tag", () => {
    const withPath = messageAttachmentSchema.parse({
      name: "/b.md",
      source: "user_ops",
      type: "text",
      content: '<action name="write">\n{}\n</action>',
      path: "/b.md",
      action: "write",
    });
    assert.equal(withPath.name, withPath.path);
    assert.equal(withPath.action, "write");

    const emptyPath = messageAttachmentSchema.parse({
      name: NO_PATH_ATTACHMENT_NAME,
      source: "user_ops",
      type: "text",
      content: null,
      action: "mkdir",
    });
    assert.equal(emptyPath.name, "__no_path__");
    assert.equal(attachmentStorageName(""), "__no_path__");
    assert.equal(attachmentStorageName(undefined), "__no_path__");

    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "write:/x.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/x.md",
        action: "write",
      }),
    );

    // 历史无 action：仍允许旧展示 name（不做批量迁移）
    const legacy = messageAttachmentSchema.parse({
      name: "write:/old.md",
      source: "user_ops",
      type: "text",
      content: null,
      path: "/old.md",
    });
    assert.equal(legacy.name, "write:/old.md");
    assert.equal(legacy.action, undefined);
  });

  it("rejects unknown source / extra keys", () => {
    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "x",
        source: "skill",
        type: "text",
        content: null,
      }),
    );
    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "x",
        source: "attach",
        type: "text",
        content: null,
        extra: 1,
      }),
    );
  });

  it("parseAttachmentsJson / serializeAttachmentsJson round-trip", () => {
    const list = [
      {
        name: "/ops.md",
        source: "user_ops" as const,
        type: "text" as const,
        content: "<a/>",
        path: "/ops.md",
        action: "write" as const,
      },
    ];
    const json = serializeAttachmentsJson(list);
    assert.ok(json != null);
    assert.deepEqual(parseAttachmentsJson(json), list);
    assert.equal(serializeAttachmentsJson([]), null);
    assert.equal(parseAttachmentsJson(null), undefined);
    assert.equal(parseAttachmentsJson("not-json"), undefined);
  });
});
