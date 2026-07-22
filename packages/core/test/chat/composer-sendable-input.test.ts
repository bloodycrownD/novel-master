import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasComposerSendableInput } from "../../src/domain/chat/logic/composer-sendable-input.js";

describe("hasComposerSendableInput", () => {
  it("trim 非空 → 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "  hi  ",
        attachmentCount: 0,
        hasPendingUserOps: false,
      }),
      true,
    );
  });

  it("仅 attachments → 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "   ",
        attachmentCount: 1,
        hasPendingUserOps: false,
      }),
      true,
    );
  });

  it("仅 pending→user_ops → 可发（空发门闩）", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: true,
      }),
      true,
    );
  });

  it("T-CR3：仅规则差集语义废止 → 空正文无 pending/批注不可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: false,
      }),
      false,
    );
  });

  it("仅 hasAnnotateDrafts → 可发（仅批注门闩）", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: false,
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
        hasPendingUserOps: false,
        hasAnnotateDrafts: false,
      }),
      false,
    );
  });

  it("T-CR4：有 pending 或批注 → 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: true,
      }),
      true,
    );
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: false,
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
        hasPendingUserOps: false,
      }),
      false,
    );
  });
});
