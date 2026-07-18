/**
 * MessageAttachment zod wire 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
    });
    assert.equal(att.source, "attach");
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
        name: "ops",
        source: "user_ops" as const,
        type: "text" as const,
        content: "<a/>",
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
