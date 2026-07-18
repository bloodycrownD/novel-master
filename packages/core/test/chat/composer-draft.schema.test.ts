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
});
