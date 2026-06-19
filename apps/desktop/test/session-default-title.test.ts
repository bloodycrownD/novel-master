import assert from "node:assert/strict";
import test from "node:test";
import { nextDefaultSessionTitle } from "@/utils/session-default-title";

test("nextDefaultSessionTitle assigns 会话1 on empty list", () => {
  assert.equal(nextDefaultSessionTitle([]), "会话1");
  assert.equal(nextDefaultSessionTitle(["", null, undefined]), "会话1");
});

test("nextDefaultSessionTitle skips occupied numbers", () => {
  assert.equal(nextDefaultSessionTitle(["会话1", "会话3"]), "会话2");
  assert.equal(nextDefaultSessionTitle(["会话1", "会话2"]), "会话3");
});

test("nextDefaultSessionTitle ignores non-numbered titles", () => {
  assert.equal(nextDefaultSessionTitle(["自定义会话", "会话2"]), "会话1");
});
