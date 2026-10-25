import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { CHAT_MESSAGE_KEYS } from "../../src/domain/chat/i18n/keys.js";

for (const locale of ["zh-CN", "en-US"]) {
  describe(`chat locale ${locale}`, () => {
    const catalogPath = new URL(`../../locales/chat.${locale}.json`, import.meta.url);
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as Record<string, string>;

    it("key 集合与 CHAT_MESSAGE_KEYS 完全一致", () => {
      assert.deepEqual(Object.keys(catalog).sort(), [...CHAT_MESSAGE_KEYS].sort());
    });

    it("所有文案非空", () => {
      for (const [key, value] of Object.entries(catalog)) {
        assert.equal(typeof value, "string", key);
        assert.notEqual(value.trim(), "", key);
      }
    });
  });
}
