/**
 * composer-draft.schema 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composerDraftSchema,
  parseComposerDraftJson,
  serializeComposerDraftJson,
  type ComposerDraftTokenRange,
} from "../../src/domain/chat/model/composer-draft.schema.js";

/** 对象是否**自有**某个键（区分「键存在但值 undefined」与「键不存在」）。 */
function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** 构造坏的区间条目（类型系统上仍声称是 TokenRange，模拟带外写入的运行期垃圾）。 */
function asTokenRanges(items: unknown[]): ComposerDraftTokenRange[] {
  return items as unknown as ComposerDraftTokenRange[];
}

/** 标准 attach 附件（roundtrip 用）。 */
const attachFixture = {
  name: "/a.md",
  source: "attach" as const,
  type: "text" as const,
  content: null,
  path: "/a.md",
};

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

// ---- T-CA1：确认态 tokenRanges 的 roundtrip / 校验 / 降级口径（D1）----

describe("T-CA1: 草稿 schema 的 tokenRanges roundtrip 与降级口径", () => {
  it("roundtrip：带 tokenRanges 读写后逐字段相等", () => {
    const draft = {
      text: "$技能 尾追",
      attachments: [{ ...attachFixture }],
      tokenRanges: [
        { start: 0, end: 3 },
        { start: 4, end: 6 },
      ],
    };
    const json = serializeComposerDraftJson(draft);
    assert.ok(json != null);
    assert.deepEqual(parseComposerDraftJson(json), draft);
  });

  it("composerDraftSchema 拒收非法区间，合法区间放行", () => {
    const badItems: unknown[] = [
      { start: 3, end: 1 }, // start > end
      { start: 2, end: 2 }, // 零长度
      { start: -1, end: 3 }, // 负数
      { start: 1.5, end: 3 }, // 非整数
      { start: "0", end: 3 }, // 非数字
      { start: 0 }, // 缺 end
      null,
      "0-3",
      [0, 3],
    ];
    for (const item of badItems) {
      const result = composerDraftSchema.safeParse({
        text: "x",
        attachments: [],
        tokenRanges: [item],
      });
      assert.equal(
        result.success,
        false,
        `应拒收 ${JSON.stringify(item)}`
      );
    }
    const okResult = composerDraftSchema.safeParse({
      text: "x",
      attachments: [],
      tokenRanges: [{ start: 0, end: 3 }],
    });
    assert.equal(okResult.success, true);
    assert.deepEqual(
      okResult.success ? okResult.data.tokenRanges : undefined,
      [{ start: 0, end: 3 }]
    );
  });

  it("坏 ranges + 正文 → text/attachments 保留、tokenRanges 降级为 undefined", () => {
    const badRanges: unknown[] = [
      [{ start: 9, end: 3 }],
      [{ start: 4, end: 4 }],
      [{ start: -2, end: 3 }],
      [{ start: 1.5, end: 3 }],
      [{ start: "0", end: 3 }],
      "0-3",
      null,
      [null],
    ];
    for (const tokenRanges of badRanges) {
      const raw = JSON.stringify({
        text: "正文不能丢",
        attachments: [attachFixture],
        tokenRanges,
      });
      const result = parseComposerDraftJson(raw);
      assert.equal(
        result.text,
        "正文不能丢",
        `正文应保留（tokenRanges=${JSON.stringify(tokenRanges)}）`
      );
      assert.equal(
        result.attachments.length,
        1,
        `附件应保留（tokenRanges=${JSON.stringify(tokenRanges)}）`
      );
      assert.equal(
        result.tokenRanges,
        undefined,
        `非法 ranges 应降级为 undefined（tokenRanges=${JSON.stringify(tokenRanges)}）`
      );
    }
  });

  it("字段存在但非法 → 结果对象同样无 tokenRanges 自有键", () => {
    const raw = JSON.stringify({
      text: "正文",
      attachments: [],
      tokenRanges: [{ start: 5, end: 1 }],
    });
    const result = parseComposerDraftJson(raw);
    assert.equal(
      hasOwn(result, "tokenRanges"),
      false,
      "非法字段不应留下自有键（防 zod optional 自带 undefined 键打破 deepEqual）"
    );
  });

  it("serialize 过滤非法条目：丢坏条目、其余照写", () => {
    const json = serializeComposerDraftJson({
      text: "正文",
      attachments: [],
      tokenRanges: asTokenRanges([
        { start: 0, end: 3 },
        { start: 5, end: 5 }, // 零长度
        { start: 8, end: 4 }, // 逆序
        { start: -1, end: 2 }, // 负数
        { start: 1.5, end: 4 }, // 非整数
        { start: "9", end: 12 }, // 非数字
        null,
        { start: 10, end: 12 },
      ]),
    });
    assert.ok(json != null);
    assert.deepEqual(JSON.parse(json), {
      text: "正文",
      attachments: [],
      tokenRanges: [
        { start: 0, end: 3 },
        { start: 10, end: 12 },
      ],
    });
  });

  it("serialize 全非法 → 写 []，不抛错", () => {
    const json = serializeComposerDraftJson({
      text: "正文",
      attachments: [],
      tokenRanges: asTokenRanges([null, { start: 3, end: 1 }, "x"]),
    });
    assert.ok(json != null, "落库链不应被坏区间炸成 null");
    assert.deepEqual(JSON.parse(json).tokenRanges, [], "全空写 []");
  });

  it("serialize：undefined 不写字段，[] 照写（undefined ≠ []）", () => {
    const withoutRanges = serializeComposerDraftJson({
      text: "手输$foo",
      attachments: [],
    });
    assert.ok(withoutRanges != null);
    assert.equal(
      hasOwn(JSON.parse(withoutRanges) as object, "tokenRanges"),
      false,
      "undefined 语义（允许兜底扫描）不应落成字段"
    );

    const emptyRanges = serializeComposerDraftJson({
      text: "手输$foo",
      attachments: [],
      tokenRanges: [],
    });
    assert.ok(emptyRanges != null);
    const parsed = JSON.parse(emptyRanges) as { tokenRanges?: unknown };
    assert.equal(
      hasOwn(parsed, "tokenRanges"),
      true,
      "[] 语义（确认无胶囊）必须落库"
    );
    assert.deepEqual(parsed.tokenRanges, []);
  });

  it("旧 JSON（无 tokenRanges 字段）→ 结果对象无自有键", () => {
    const result = parseComposerDraftJson(
      JSON.stringify({ text: "旧草稿", attachments: [] })
    );
    assert.equal(result.text, "旧草稿");
    assert.equal(result.tokenRanges, undefined);
    assert.equal(hasOwn(result, "tokenRanges"), false);
  });

  it("旧代码读新 JSON（parse 自构造对象路径）→ text 保留、ranges 静默丢弃", () => {
    const json = serializeComposerDraftJson({
      text: "$技能 尾追",
      attachments: [],
      tokenRanges: [{ start: 0, end: 3 }],
    });
    assert.ok(json != null);
    const wire = JSON.parse(json) as {
      text: string;
      attachments: unknown[];
      tokenRanges: unknown;
    };
    assert.ok(
      Array.isArray(wire.tokenRanges),
      "前提：新 JSON 确实带 tokenRanges"
    );

    // 旧实现只把自构造的 { text, attachments } 喂 schema——未知键到不了 .strict()，
    // 因此新字段不会让旧代码把正文一起判废；ranges 静默丢弃（下次写回永久丢失）。
    const legacyRead = composerDraftSchema.safeParse({
      text: wire.text,
      attachments: wire.attachments,
    });
    assert.equal(legacyRead.success, true, "旧读取路径不应因新字段失败");
    assert.equal(
      legacyRead.success ? legacyRead.data.text : "",
      "$技能 尾追"
    );
    assert.equal(
      legacyRead.success ? hasOwn(legacyRead.data, "tokenRanges") : true,
      false,
      "旧读取路径不会带上 tokenRanges"
    );
  });

  it("既有清空口径不变：空正文 + 空附件 → null（即使带 ranges）", () => {
    assert.equal(
      serializeComposerDraftJson({
        text: "",
        attachments: [],
        tokenRanges: [{ start: 0, end: 3 }],
      }),
      null,
      "空正文空附件的 NULL 口径优先于 ranges"
    );
  });
});

