/** common/xml 单测。 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeXmlAttr, escapeXmlText, unescapeXmlText } from "../../src/common/xml.js";

describe("common/xml", () => {
  it("转义文本与属性", () => {
    assert.equal(escapeXmlText('a & b < c > d "e"'), "a &amp; b &lt; c &gt; d \"e\"");
    assert.equal(escapeXmlAttr('a "b" & c'), "a &quot;b&quot; &amp; c");
  });

  it("解码 XML / HTML / 数字 entity", () => {
    assert.equal(unescapeXmlText("&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;"), "<a> & \"b\" 'c'");
    assert.equal(unescapeXmlText("&ldquo;你好&rdquo; &hellip;"), "“你好” …");
    assert.equal(unescapeXmlText("&#65;&#x42;"), "AB");
    assert.equal(unescapeXmlText("&unknown;"), "&unknown;");
  });

  it("&amp; 只解一层", () => {
    assert.equal(unescapeXmlText("&amp;lt;"), "&lt;");
  });
});
