/**
 * B4：Desktop Composer 正文晚清（对齐 Mobile；禁止 started 清）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldClearComposerBodyAfterAgentStarted,
  shouldClearComposerBodyOnUserMessageAppended,
} from "@/features/chat/composer-body-clear";

test("B4: ipcAgentRun started/ok 后不清正文", () => {
  assert.equal(shouldClearComposerBodyAfterAgentStarted(), false);
});

test("B4: userMessageAppended 同 session 后清正文", () => {
  assert.equal(
    shouldClearComposerBodyOnUserMessageAppended("s1", "s1"),
    true,
  );
});

test("B4: userMessageAppended 异 session 不清当前正文（D1 仅清 store）", () => {
  assert.equal(
    shouldClearComposerBodyOnUserMessageAppended("s-append", "s-viewing"),
    false,
  );
});

/**
 * 模拟 ChatComposer 两阶段：started 保留草稿；append 同会话再清。
 */
test("B4: 模拟 started 保留正文 → append 同会话再清", () => {
  let body = "draft that must survive started";
  const onChange = (text: string) => {
    body = text;
  };

  // ipcAgentRun ok / started:true
  if (shouldClearComposerBodyAfterAgentStarted()) {
    onChange("");
  }
  assert.equal(body, "draft that must survive started");

  // nm:agent/userMessageAppended
  if (shouldClearComposerBodyOnUserMessageAppended("s1", "s1")) {
    onChange("");
  }
  assert.equal(body, "");
});
