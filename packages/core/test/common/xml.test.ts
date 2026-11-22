/** common/xml 单测。 */

import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  Xml  } from "../../src/common/xml.js";

describe("common/xml · Xml", () => {
    it("转义文本与属性", () => {
        assert.equal(Xml.escapeText('a & b < c > d "e"'), "a &amp; b &lt; c &gt; d \"e\"");
        assert.equal(Xml.escapeAttr('a "b" & c'), "a &quot;b&quot; &amp; c");
    });

    it("解码 XML / HTML / 数字 entity", () => {
        assert.equal(Xml.unescapeText("&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;"), "<a> & \"b\" 'c'");
        assert.equal(Xml.unescapeText("&ldquo;你好&rdquo; &hellip;"), "“你好” …");
        assert.equal(Xml.unescapeText("&#65;&#x42;"), "AB");
        assert.equal(Xml.unescapeText("&unknown;"), "&unknown;");
        // 原型链上的同名属性不得被当成命名实体（对象字面量查表会泄漏原生函数源码）。
        assert.equal(Xml.unescapeText("&constructor;"), "&constructor;");
        assert.equal(Xml.unescapeText("&toString;"), "&toString;");
        assert.equal(Xml.unescapeText("&valueOf;"), "&valueOf;");
    });

    it("&amp; 只解一层", () => {
        assert.equal(Xml.unescapeText("&amp;lt;"), "&lt;");
    });
});
