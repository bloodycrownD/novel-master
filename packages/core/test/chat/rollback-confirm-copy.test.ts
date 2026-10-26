import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { createTranslator, type MessageCatalog } from "../../src/common/i18n.js";
import type { ChatMessageKey } from "../../src/domain/chat/i18n/keys.js";
import { rollbackConfirm } from "../../src/presentation/chat/rollback-confirm.js";

const zhCN = JSON.parse(fs.readFileSync(new URL("../../locales/chat.zh-CN.json", import.meta.url), "utf8")) as MessageCatalog<ChatMessageKey>;
const enUS = JSON.parse(fs.readFileSync(new URL("../../locales/chat.en-US.json", import.meta.url), "utf8")) as MessageCatalog<ChatMessageKey>;
const translateZh = createTranslator({ "zh-CN": zhCN }, "zh-CN");
const translateEn = createTranslator({ "en-US": enUS }, "en-US");

describe("rollbackConfirm", () => {
  it("undo_send primary 含「及之后」", () => {
    const message = translateZh(rollbackConfirm.descriptor("undo_send", "primary"));
    assert.match(message, /及之后/);
    assert.match(message, /撤销相关文件修改/);
    assert.doesNotMatch(message, /\*\*/);
  });

  it("rewind primary 含「之后」但不含「及之后」", () => {
    const message = translateZh(rollbackConfirm.descriptor("rewind", "primary"));
    assert.match(message, /之后/);
    assert.doesNotMatch(message, /及之后/);
  });

  it("undo_send degraded 含「及之后」", () => {
    const message = translateZh(rollbackConfirm.descriptor("undo_send", "degraded"));
    assert.match(message, /及之后/);
    assert.match(message, /工作区文件将保持现状/);
  });

  it("rewind degraded 不含「及之后」", () => {
    assert.doesNotMatch(translateZh(rollbackConfirm.descriptor("rewind", "degraded")), /及之后/);
  });

  it("backfill undo_send 末句为发送前状态", () => {
    const message = translateZh(rollbackConfirm.descriptor("undo_send", "backfill", { missingPaths: ["/a.md"] }));
    assert.match(message, /回滚至发送前状态/);
    assert.doesNotMatch(message, /回滚至锚点/);
    assert.match(message, /· a\.md/);
  });

  it("backfill rewind 末句为锚点", () => {
    const message = translateZh(rollbackConfirm.descriptor("rewind", "backfill", { missingPaths: ["/a.md"] }));
    assert.match(message, /回滚至锚点/);
  });

  it("descriptor 返回可序列化 key + params", () => {
    assert.deepEqual(rollbackConfirm.descriptor("undo_send", "primary"), { key: "chat.rollback.confirm.primary.undo_send" });
    assert.deepEqual(rollbackConfirm.descriptor("rewind", "backfill", { missingPaths: ["/a.md"] }), {
      key: "chat.rollback.confirm.backfill",
      params: {
        files: [{ key: "chat.rollback.confirm.backfill.file", params: { path: "a.md" } }],
        tail: { key: "chat.rollback.confirm.backfill.tail.rewind" },
      },
    });
  });

  it("en-US catalog 可翻译同一 descriptor", () => {
    const message = translateEn(rollbackConfirm.descriptor("rewind", "primary"));
    assert.match(message, /revert related file changes/);
  });

  it("字符串直传通道原样返回", () => {
    assert.equal(translateZh("legacy toast"), "legacy toast");
  });
});
