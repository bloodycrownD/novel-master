/**
 * composer-draft.schema 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composerDraftSchema,
  parseComposerDraftJson,
  serializeComposerDraftJson,
} from "../../src/domain/chat/model/composer-draft.schema.js";

describe("composerDraftSchema", () => {
  it("接受仅 attach 的草稿", () => {
    const draft = composerDraftSchema.parse({
      text: "hello",
      attachments: [
        {
          name: "/a.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/a.md",
        },
      ],
    });
    assert.equal(draft.text, "hello");
    assert.equal(draft.attachments.length, 1);
    assert.equal(draft.attachments[0]?.source, "attach");
  });

  it("规范化剥掉非 attach 附件", () => {
    const draft = composerDraftSchema.parse({
      text: "keep",
      attachments: [
        {
          name: "/w.md",
          source: "workplace",
          type: "text",
          content: null,
          path: "/w.md",
        },
        {
          name: "/a.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/a.md",
        },
        {
          name: "ops",
          source: "user_ops",
          type: "text",
          content: "<a/>",
        },
      ],
    });
    assert.equal(draft.attachments.length, 1);
    assert.equal(draft.attachments[0]?.path, "/a.md");
  });

  it("parseComposerDraftJson / serializeComposerDraftJson round-trip", () => {
    const draft = {
      text: "草稿正文",
      attachments: [
        {
          name: "/ref.md",
          source: "attach" as const,
          type: "text" as const,
          content: null,
          path: "/ref.md",
        },
      ],
    };
    const json = serializeComposerDraftJson(draft);
    assert.ok(json != null);
    assert.deepEqual(parseComposerDraftJson(json), draft);
    assert.equal(serializeComposerDraftJson({ text: "", attachments: [] }), null);
    assert.deepEqual(parseComposerDraftJson(null), {
      text: "",
      attachments: [],
    });
    assert.deepEqual(parseComposerDraftJson("not-json"), {
      text: "",
      attachments: [],
    });
  });

  it("serialize 写入前剥掉非 attach", () => {
    const json = serializeComposerDraftJson({
      text: "x",
      attachments: [
        {
          name: "/w.md",
          source: "workplace",
          type: "text",
          content: null,
          path: "/w.md",
        },
        {
          name: "/a.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/a.md",
        },
      ],
    });
    assert.ok(json != null);
    const parsed = JSON.parse(json) as {
      attachments: Array<{ source: string }>;
    };
    assert.equal(parsed.attachments.length, 1);
    assert.equal(parsed.attachments[0]?.source, "attach");
  });

  // ---- 逐条降级：正文永不因附件而丢（vestigial 字段硬化，P2 量级）----

  it("CD-1: 非法附件不牵连正文（text 保留）", () => {
    const raw = JSON.stringify({
      text: "我写了一半",
      attachments: [
        {
          name: "/bad.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/bad.md",
          extra: 1,
        },
      ],
    });
    const result = parseComposerDraftJson(raw);
    // 断言必须是「text 等于那个具体非空字符串」，不能写「text 非空」——
    // 后者在返回空串时恒红、返回 undefined 时恒绿，两种退化都测不出来
    assert.equal(result.text, "我写了一半", "正文不应因附件非法而丢");
    assert.equal(result.attachments.length, 0, "非法附件应被逐条丢弃");
  });

  it("CD-2: 部分非法附件逐条丢弃且保序", () => {
    const legal1 = {
      name: "/a.md",
      source: "attach",
      type: "text",
      content: null,
      path: "/a.md",
    };
    const legal2 = {
      name: "/b.md",
      source: "attach",
      type: "text",
      content: null,
      path: "/b.md",
    };
    const result = parseComposerDraftJson(
      JSON.stringify({
        text: "正文还在",
        attachments: [
          legal1,
          { name: "/bad.md", source: "attach", type: "text", extra: 1 },
          legal2,
        ],
      }),
    );
    assert.equal(result.text, "正文还在");
    assert.equal(result.attachments.length, 2, "两条合法附件应存活");
    assert.deepEqual(
      result.attachments.map((a) => a.path),
      ["/a.md", "/b.md"],
      "存活项应保持输入顺序",
    );
  });

  it("CD-3: 顶层非草稿形状仍整体降级为空草稿（既有行为回归锁）", () => {
    // JSON.parse 失败 / 非对象 / null / 标量 / 数组
    for (const raw of [
      "not-json",
      "null",
      "123",
      '"just-a-string"',
      "[1,2]",
      JSON.stringify({ attachments: [] }),
    ]) {
      assert.deepEqual(
        parseComposerDraftJson(raw),
        { text: "", attachments: [] },
        `顶层非草稿形状（${raw}）应整体降级为空草稿`,
      );
    }
    // 非 attach 源仍被剥掉（既有行为）
    const stripped = parseComposerDraftJson(
      JSON.stringify({
        text: "keep",
        attachments: [
          {
            name: "/w.md",
            source: "workplace",
            type: "text",
            content: null,
            path: "/w.md",
          },
          {
            name: "/a.md",
            source: "attach",
            type: "text",
            content: null,
            path: "/a.md",
          },
        ],
      }),
    );
    assert.equal(stripped.text, "keep");
    assert.deepEqual(
      stripped.attachments.map((a) => a.path),
      ["/a.md"],
      "非 attach 源仍应被剥掉",
    );
  });
});
