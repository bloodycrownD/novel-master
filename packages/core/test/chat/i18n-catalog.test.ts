import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  CHAT_MESSAGE_KEYS  } from "../../src/domain/chat/i18n/keys.js";
import {  CHAT_CATALOGS  } from "../../src/i18n/generated-chat-catalog.js";

for (const locale of ["zh-CN", "en-US"]) {
    describe(`chat locale ${locale}`, () => {
        // i18n 双轨收敛：catalog 唯一真源是 src/i18n/catalog/*.yaml 的 chat 段（生成物 generated-chat-catalog.ts）。
        const catalog = CHAT_CATALOGS[locale] as Record<string, string>;

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
