import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasComposerSendableInput } from "../../src/domain/chat/logic/composer-sendable-input.js";

describe("hasComposerSendableInput", () => {
  it("trim 非空 → 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "  hi  ",
        attachmentCount: 0,
      }),
      true,
    );
  });

  it("仅 attachments → 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "   ",
        attachmentCount: 1,
      }),
      true,
    );
  });

  it("T-CR3：空正文无 attach/批注不可发（pending 门闩已随 user ops 拆除废止）", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
      }),
      false,
    );
  });

  it("仅 hasAnnotateDrafts → 可发（仅批注门闩）", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasAnnotateDrafts: true,
      }),
      true,
    );
  });

  it("hasAnnotateDrafts 缺省/false → 不可发（兼容旧调用）", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasAnnotateDrafts: false,
      }),
      false,
    );
  });

  it("T-CR4：仅批注草稿 → 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasAnnotateDrafts: true,
      }),
      true,
    );
  });

  it("三者皆空 → 不可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
      }),
      false,
    );
  });
});
