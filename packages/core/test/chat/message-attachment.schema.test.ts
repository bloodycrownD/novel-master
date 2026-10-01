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

    // 有 action 时 name 须 === attachmentStorageName(path)
    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "/wrong.md",
        source: "user_ops",
        type: "text",
        content: null,
        path: "/right.md",
        action: "write",
      }),
    );
    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "自定义名",
        source: "user_ops",
        type: "text",
        content: null,
        action: "mkdir",
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

  it("T-SK11: skillAttach 附件——skillName 必填、跳过 name===path 规则；严格模式仍拒未知键", () => {
    const att = messageAttachmentSchema.parse({
      name: "demo",
      source: "attach",
      type: "text",
      content: null,
      skillName: "demo",
      action: "skillAttach",
    });
    assert.equal(att.action, "skillAttach");
    assert.equal(att.skillName, "demo");
    assert.equal(att.path, undefined);

    // 缺 skillName → 拒绝（分支内必填校验）
    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "demo",
        source: "attach",
        type: "text",
        content: null,
        action: "skillAttach",
      }),
    );
    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "demo",
        source: "attach",
        type: "text",
        content: null,
        skillName: "",
        action: "skillAttach",
      }),
    );

    // messageAttachmentObjectSchema 是 .strict()：skillName 已声明可解，其余未知键仍拒
    assert.throws(() =>
      messageAttachmentSchema.parse({
        name: "demo",
        source: "attach",
        type: "text",
        content: null,
        skillName: "demo",
        action: "skillAttach",
        extra: 1,
      }),
    );
  });

  it("parseAttachmentsJson / serializeAttachmentsJson round-trip（含 skillAttach）", () => {
    const list = [
      {
        name: "/ops.md",
        source: "user_ops" as const,
        type: "text" as const,
        content: "<a/>",
        path: "/ops.md",
        action: "write" as const,
      },
      {
        name: "demo",
        source: "attach" as const,
        type: "text" as const,
        content: null,
        skillName: "demo",
        action: "skillAttach" as const,
      },
    ];
    const json = serializeAttachmentsJson(list);
    assert.ok(json != null);
    assert.deepEqual(parseAttachmentsJson(json), list);
    assert.equal(serializeAttachmentsJson([]), null);
    assert.equal(parseAttachmentsJson(null), undefined);
    assert.equal(parseAttachmentsJson("not-json"), undefined);
  });

  // ---- 逐条降级：一条不合规不牵连其余（append-only 历史数据的宽容读法）----

  /** 一条合法 attach 附件。 */
  const legalA = {
    name: "/a.md",
    source: "attach" as const,
    type: "text" as const,
    content: null,
    path: "/a.md",
  };
  /** 一条合法 skillAttach 附件。 */
  const legalB = {
    name: "demo",
    source: "attach" as const,
    type: "text" as const,
    content: null,
    skillName: "demo",
    action: "skillAttach" as const,
  };

  it("MA-1: 单条非法附件不牵连其余（保序）", () => {
    const parsed = parseAttachmentsJson(
      JSON.stringify([
        legalA,
        // 未知键（.strict() 拒）
        { ...legalA, name: "/bad.md", path: "/bad.md", extra: 1 },
        legalB,
      ]),
    );
    assert.ok(parsed != null);
    assert.equal(parsed.length, 2, "一条非法不应牵连其余");
    assert.deepEqual(parsed[0], legalA, "第 0 位应是第一条合法附件（保序）");
    assert.deepEqual(parsed[1], legalB, "第 1 位应是第二条合法附件（保序）");
  });

  it("MA-2: 全部非法 ⇒ 空数组（不是 undefined、不是 null）", () => {
    const parsed = parseAttachmentsJson(
      JSON.stringify([{ source: "attach", type: "text", extra: 1 }]),
    );
    assert.deepEqual(
      parsed,
      [],
      "全被逐条丢弃时返回 []，让「本来就没附件」与「全被丢弃」下游表现一致",
    );
  });

  it("MA-3: 非 JSON / 非数组 ⇒ 仍返回 undefined（既有行为回归锁）", () => {
    assert.equal(parseAttachmentsJson(null), undefined);
    assert.equal(parseAttachmentsJson(""), undefined);
    assert.equal(parseAttachmentsJson("not-json"), undefined);
    // 非数组（无粒度可 salv，整体降级）
    assert.equal(parseAttachmentsJson('{"a":1}'), undefined);
    assert.equal(parseAttachmentsJson("null"), undefined);
    assert.equal(parseAttachmentsJson("123"), undefined);
  });

  it("MA-D2: 标量元素数组 ⇒ []（元素不是对象，逐条全丢）", () => {
    assert.deepEqual(parseAttachmentsJson("[1,2]"), []);
    assert.deepEqual(parseAttachmentsJson("[null]"), []);
  });
});
