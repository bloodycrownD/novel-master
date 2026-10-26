/**
 * Desktop Composer 发送门闩：正文 `@` / 状态投影（T-CR3 / T-ATD*）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { composerSendPolicy } from "@/features/chat/composer-send-intent";

test("T-CR3: 空输入 + 无 resume → 不可发；attachOnly 恒空", () => {
  const intent = composerSendPolicy.evaluate({
    text: "",
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(intent.sendDisabled, true);
  assert.equal(intent.hasSendable, false);
  assert.equal(intent.allowResumeWithoutInput, false);
  assert.equal(intent.attachOnly.length, 0);
});

test("T-ATD*: 正文含 @path 可发；attachOnly 恒空", () => {
  const intent = composerSendPolicy.evaluate({
    text: "见 @/a.md",
    canResumeWithoutInput: true,
    hasModel: true,
  });
  assert.equal(intent.sendDisabled, false);
  assert.equal(intent.attachOnly.length, 0);
  assert.equal(intent.hasSendable, true);
});

test("空输入 + 不可 resume → 禁用发送", () => {
  const intent = composerSendPolicy.evaluate({
    text: "",
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(intent.sendDisabled, true);
  assert.equal(intent.hasSendable, false);
});

test("T-AN4: 仅 hasAnnotateDrafts → 可发；intent 须透传", () => {
  const without = composerSendPolicy.evaluate({
    text: "",
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(without.hasSendable, false);
  assert.equal(without.sendDisabled, true);

  const withAnnotate = composerSendPolicy.evaluate({
    text: "",
    canResumeWithoutInput: false,
    hasAnnotateDrafts: true,
    hasModel: true,
  });
  assert.equal(withAnnotate.hasSendable, true);
  assert.equal(withAnnotate.sendDisabled, false);
  assert.equal(withAnnotate.allowResumeWithoutInput, false);
});
