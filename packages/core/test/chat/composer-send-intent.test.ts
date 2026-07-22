/**
 * Composer 发送门闩（T-CR3 / T-ATD* / T-AN4）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveComposerSendIntent } from "../../src/domain/chat/logic/composer-send-intent.js";

describe("resolveComposerSendIntent", () => {
  it("T-CR3: 仅状态条 workplace → 不可发；入参无预览 chip", () => {
    const intent = resolveComposerSendIntent({
      text: "",
      attachments: [{ source: "workplace" }],
      hasPendingUserOps: false,
      canResumeWithoutInput: false,
      hasModel: true,
    });
    assert.equal(intent.sendDisabled, true);
    assert.equal(intent.hasSendable, false);
    assert.equal(intent.allowResumeWithoutInput, false);
    assert.equal(intent.attachOnly.length, 0);
  });

  it("T-ATD*: 正文含 @path 可发；draft attach chip 不计入门闩", () => {
    const intent = resolveComposerSendIntent({
      text: "见 @/a.md",
      attachments: [{ source: "attach" }],
      hasPendingUserOps: false,
      canResumeWithoutInput: true,
      hasModel: true,
    });
    assert.equal(intent.sendDisabled, false);
    assert.equal(intent.attachOnly.length, 0);
    assert.equal(intent.hasSendable, true);
  });

  it("空输入 + 不可 resume → 禁用发送", () => {
    const intent = resolveComposerSendIntent({
      text: "",
      attachments: [],
      hasPendingUserOps: false,
      canResumeWithoutInput: false,
      hasModel: true,
    });
    assert.equal(intent.sendDisabled, true);
    assert.equal(intent.hasSendable, false);
  });

  it("T-AN4: 仅 hasAnnotateDrafts → 可发；intent 须透传", () => {
    const without = resolveComposerSendIntent({
      text: "",
      attachments: [],
      hasPendingUserOps: false,
      canResumeWithoutInput: false,
      hasModel: true,
    });
    assert.equal(without.hasSendable, false);
    assert.equal(without.sendDisabled, true);

    const withAnnotate = resolveComposerSendIntent({
      text: "",
      attachments: [],
      hasPendingUserOps: false,
      canResumeWithoutInput: false,
      hasAnnotateDrafts: true,
      hasModel: true,
    });
    assert.equal(withAnnotate.hasSendable, true);
    assert.equal(withAnnotate.sendDisabled, false);
    assert.equal(withAnnotate.allowResumeWithoutInput, false);
  });

  it("running 时即使无可发输入也不禁用（供中止）", () => {
    const intent = resolveComposerSendIntent({
      text: "",
      attachments: [],
      hasPendingUserOps: false,
      canResumeWithoutInput: false,
      hasModel: true,
      running: true,
    });
    assert.equal(intent.sendDisabled, false);
    assert.equal(intent.hasSendable, false);
  });
});
