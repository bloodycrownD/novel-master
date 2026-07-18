/**
 * Desktop Composer 发送门闩：正文 `@` / 状态投影（T-SR1b / T-ATD*）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MessageAttachmentDto } from "@shared/ipc-types";
import { resolveComposerSendIntent } from "@/features/chat/composer-send-intent";

function att(
  partial: Partial<MessageAttachmentDto> &
    Pick<MessageAttachmentDto, "source" | "type">,
): MessageAttachmentDto {
  return {
    name: partial.name ?? partial.path ?? "x",
    content: null,
    path: partial.path ?? null,
    ...partial,
  };
}

test("T-SR1b: 仅状态条 workplace 可发且 allowResume=false；入参无预览 chip", () => {
  const intent = resolveComposerSendIntent({
    text: "",
    attachments: [
      att({
        source: "workplace",
        type: "text",
        path: "/w.md",
        name: "w.md",
      }),
    ],
    hasPendingUserOps: false,
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(intent.sendDisabled, false);
  assert.equal(intent.hasSendable, true);
  assert.equal(intent.allowResumeWithoutInput, false);
  assert.equal(intent.attachOnly.length, 0);
  assert.equal(intent.hasWorkplaceDelta, true);
});

test("T-ATD*: 正文含 @path 可发；draft attach chip 不计入门闩", () => {
  const intent = resolveComposerSendIntent({
    text: "见 @/a.md",
    attachments: [
      att({
        source: "attach",
        type: "text",
        path: "/ignored.md",
        name: "ignored.md",
      }),
    ],
    hasPendingUserOps: false,
    canResumeWithoutInput: true,
    hasModel: true,
  });
  assert.equal(intent.sendDisabled, false);
  assert.equal(intent.attachOnly.length, 0);
  assert.equal(intent.hasSendable, true);
});

test("空输入 + 不可 resume → 禁用发送", () => {
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
