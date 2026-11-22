import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  Text  } from "../../src/common/text.js";

describe("common/text · Text.truncate", () => {
    it("未超长原样返回（含恰好等于上限）", () => {
        assert.equal(Text.truncate("abc", 5), "abc");
        assert.equal(Text.truncate("abc", 3), "abc");
        assert.equal(Text.truncate("", 0), "");
    });

    it("超长保留前 maxChars 个字符并追加省略号", () => {
        assert.equal(Text.truncate("abcdef", 3), "abc…");
        assert.equal(Text.truncate("abcdef", 0), "…");
    });

    it("按 UTF-16 码元计数（与 slice 既有口径一致）", () => {
        assert.equal(Text.truncate("你好世界", 2), "你好…");
        assert.equal(Text.truncate("😀😀😀", 2), "😀…");
    });
});

describe("common/text · Text.truncateToBytes", () => {
    it("未超字节上限原样返回（含恰好等于上限）", () => {
        assert.equal(Text.truncateToBytes("abc", 5), "abc");
        assert.equal(Text.truncateToBytes("abc", 3), "abc");
        assert.equal(Text.truncateToBytes("中", 3), "中");
        assert.equal(Text.truncateToBytes("", 0), "");
    });

    it("按 UTF-8 字节保留最长前缀并追加省略号", () => {
        assert.equal(Text.truncateToBytes("abcd", 3), "abc…");
        assert.equal(Text.truncateToBytes("你好世界", 6), "你好…");
        assert.equal(Text.truncateToBytes("你好世界", 5), "你…");
    });

    it("不切断代理对（emoji 按 4 字节整体保留或整体舍弃）", () => {
        assert.equal(Text.truncateToBytes("😀😀😀", 4), "😀…");
        assert.equal(Text.truncateToBytes("😀😀😀", 3), "…");
        assert.equal(Text.truncateToBytes("a😀b", 4), "a…");
        assert.equal(Text.truncateToBytes("a😀b", 5), "a😀…");
    });

    it("落单代理按 3 字节计（与 TextEncoder 替换字符口径一致）", () => {
        assert.equal(Text.truncateToBytes("x\uD800y", 2), "x…");
    });

    it("maxBytes 为 0 / 负数 / NaN → 空串外一律 “…”；Infinity 原样返回", () => {
        assert.equal(Text.truncateToBytes("abc", 0), "…");
        assert.equal(Text.truncateToBytes("abc", -1), "…");
        assert.equal(Text.truncateToBytes("abc", Number.NaN), "…");
        assert.equal(Text.truncateToBytes("abc", Number.POSITIVE_INFINITY), "abc");
    });
});

describe("common/text · Text.escapeRegExp", () => {
    it("对全量正则元字符逐字转义", () => {
        const meta = ".*+?^${}()|[]\\";
        assert.equal(
            Text.escapeRegExp(meta),
            "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\",
        );
        assert.ok(new RegExp(`^${Text.escapeRegExp(meta)}$`).test(meta));
    });

    it("普通文本原样返回；转义结果可作为字面量匹配", () => {
        assert.equal(Text.escapeRegExp("plain text"), "plain text");
        assert.equal(Text.escapeRegExp(""), "");
        const literal = "a.b*c?";
        assert.ok(new RegExp(`^${Text.escapeRegExp(literal)}$`).test(literal));
        assert.equal(new RegExp(`^${Text.escapeRegExp(literal)}$`).test("axbbbc"), false);
    });
});

describe("common/text · Text.stripLinePrefix", () => {
    it("逐行剥前缀，每行至多替换一次（非全局正则也只剥第一个匹配）", () => {
        assert.equal(Text.stripLinePrefix("1|a\n2|b", /^\d+\|/), "a\nb");
        assert.equal(Text.stripLinePrefix("1|a|b\n2|", /^\d+\|/), "a|b\n");
    });

    it("不匹配的行原样保留；空串 / 单行 / 末尾换行按 \\n 切分拼回", () => {
        assert.equal(Text.stripLinePrefix("", /^\d+\|/), "");
        assert.equal(Text.stripLinePrefix("plain", /^\d+\|/), "plain");
        assert.equal(Text.stripLinePrefix("1|a\n", /^\d+\|/), "a\n");
    });

    it("判据全在 pattern 里：前导空格是否容忍由调用方正则决定", () => {
        const zeroIndent = /^\d+\|/;
        const spaceTolerant = /^ +\d+\|/;
        assert.equal(Text.stripLinePrefix("  1|a", zeroIndent), "  1|a");
        assert.equal(Text.stripLinePrefix("  1|a", spaceTolerant), "a");
    });
});

describe("common/text · Text.escapeHtml", () => {
    it("转义 & < > \" 四个实体（不含单引号）", () => {
        assert.equal(Text.escapeHtml('a&b<c>d"e'), "a&amp;b&lt;c&gt;d&quot;e");
        assert.equal(Text.escapeHtml("'single'"), "'single'");
        assert.equal(Text.escapeHtml(""), "");
    });

    it("入参取 unknown：非字符串先 String 化", () => {
        assert.equal(Text.escapeHtml(123), "123");
        assert.equal(Text.escapeHtml(null), "null");
        assert.equal(Text.escapeHtml(undefined), "undefined");
    });
});

describe("common/text · Text.decodeHtmlEntities", () => {
    it("命名实体与十进制 / 十六进制数值实体", () => {
        assert.equal(Text.decodeHtmlEntities("&quot;x&quot;"), '"x"');
        assert.equal(Text.decodeHtmlEntities("&#34;x&#34;"), '"x"');
        assert.equal(Text.decodeHtmlEntities("&#x22;x&#x22;"), '"x"');
        assert.equal(Text.decodeHtmlEntities("&apos;x&apos;"), "'x'");
        assert.equal(Text.decodeHtmlEntities("&lt;x&gt;"), "<x>");
    });

    it("多轮解码双重编码（&amp;quot; → \"）", () => {
        assert.equal(Text.decodeHtmlEntities("&amp;quot;x&amp;quot;"), '"x"');
        assert.equal(Text.decodeHtmlEntities("&amp;lt;x&amp;gt;"), "<x>");
    });

    it("preserveAngleBrackets 保留尖括号实体（sanitize 出口形态）", () => {
        assert.equal(Text.decodeHtmlEntities("&lt;x&gt;&amp;quot;y&amp;quot;", {preserveAngleBrackets: true}), "&lt;x&gt;\"y\"");
    });

    it("非字符串按 String(value || \"\") 口径（falsy → 空串）", () => {
        assert.equal(Text.decodeHtmlEntities(null), "");
        assert.equal(Text.decodeHtmlEntities(undefined), "");
        assert.equal(Text.decodeHtmlEntities(0), "");
        assert.equal(Text.decodeHtmlEntities(123), "123");
    });
});
