import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextForkSessionTitle } from "../../src/domain/chat/logic/fork-session-title.js";

describe("nextForkSessionTitle", () => {
  it("appends _ckpt_n with incrementing n", () => {
    assert.equal(nextForkSessionTitle("新会话1", []), "新会话1_ckpt_1");
    assert.equal(
      nextForkSessionTitle("新会话1", ["新会话1_ckpt_1"]),
      "新会话1_ckpt_2",
    );
    assert.equal(
      nextForkSessionTitle("新会话1", ["新会话1_ckpt_1", "新会话1_ckpt_3"]),
      "新会话1_ckpt_4",
    );
  });

  it("uses 会话 when source title is empty", () => {
    assert.equal(nextForkSessionTitle(null, []), "会话_ckpt_1");
  });
});
