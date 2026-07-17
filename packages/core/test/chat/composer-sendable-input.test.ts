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

  it("T-SR1b：仅 hasWorkplaceDelta → 可发", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: false,
        hasWorkplaceDelta: true,
      }),
      true,
    );
  });

  it("hasWorkplaceDelta 缺省/false → 不可发（兼容旧调用）", () => {
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: false,
      }),
      false,
    );
    assert.equal(
      hasComposerSendableInput({
        text: "",
        attachmentCount: 0,
        hasPendingUserOps: false,
        hasWorkplaceDelta: false,
      }),
      false,
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
