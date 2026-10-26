/** common/i18n 运行时单测。 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTranslator, type MessageCatalog } from "../../src/common/i18n.js";

const zhCN = {
  greeting: "你好，{name}",
  items: (params: { readonly names?: readonly string[] }) => (params.names ?? []).map((name) => `· ${name}`).join("\n"),
} as const;

const enUS: MessageCatalog<keyof typeof zhCN> = {
  greeting: "Hello, {name}",
  items: (params) => ((params.names as readonly string[] | undefined) ?? []).map((name) => `· ${name}`).join("\n"),
};

const translate = createTranslator({ "zh-CN": zhCN, "en-US": enUS }, "zh-CN");

describe("common/i18n", () => {
  it("descriptor 按 locale 插值", () => {
    assert.equal(translate({ key: "greeting", params: { name: "小明" } }), "你好，小明");
    assert.equal(translate({ key: "greeting", params: { name: "Ming" } }, "en-US"), "Hello, Ming");
  });

  it("字符串直传通道原样返回", () => {
    assert.equal(translate("legacy message"), "legacy message");
  });

  it("未知 locale 回落默认语言；未知 key 返回 key", () => {
    assert.equal(translate({ key: "greeting", params: { name: "A" } }, "fr-FR"), "你好，A");
    assert.equal(translate({ key: "missing" as keyof typeof zhCN }), "missing");
  });

  it("函数模板可处理列表等复杂参数", () => {
    assert.equal(translate({ key: "items", params: { names: ["a", "b"] } }), "· a\n· b");
  });

  it("非语言标签的 locale 按语言前缀回落", () => {
    assert.equal(translate({ key: "greeting", params: { name: "A" } }, "en"), "Hello, A");
  });
});
