import assert from "node:assert/strict";
import test from "node:test";
import {
  nearBottom,
  offsetFromBottom,
  scrollTopForBottom,
} from "@/features/chat/chat-messages-scroll";

test("offsetFromBottom measures distance to visual bottom", () => {
  assert.equal(offsetFromBottom(100, 500, 300), 100);
  assert.equal(offsetFromBottom(200, 500, 300), 0);
  assert.equal(offsetFromBottom(250, 500, 300), 0);
});

test("nearBottom is true within threshold", () => {
  assert.equal(nearBottom(120, 500, 300, 80), true);
  assert.equal(nearBottom(100, 500, 300, 80), false);
});

test("scrollTopForBottom pins to visual bottom", () => {
  assert.equal(scrollTopForBottom(500, 300), 200);
  assert.equal(scrollTopForBottom(200, 300), 0);
});
