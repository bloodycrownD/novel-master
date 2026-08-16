/**
 * resolve-hide-message-range 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { ContentBlock } from "../../src/domain/chat/model/content-block.js";
import { resolveHideMessageRange } from "../../src/domain/depth/logic/resolve-hide-message-range.js";
import { messageIdsInSlice } from "../../src/domain/depth/logic/depth-slice.js";
import { listVisibleForDepth } from "../../src/domain/depth/logic/depth-from-tail.js";

function makeMsg(
  id: string,
  seq: number,
  role: string,
  blocks?: readonly ContentBlock[],
): ChatMessage {
  return {
    id,
    sessionId: "s1",
    seq,
    role,
    content: { blocks: blocks ?? [{ type: "text", text: id }] },
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

describe("resolveHideMessageRange", () => {
  const all = [
    makeMsg("m1", 1, "assistant"),
    makeMsg("m2", 2, "user"),
    makeMsg("m3", 3, "assistant"),
    makeMsg("m4", 4, "user"),
    makeMsg("m5", 5, "assistant"),
    makeMsg("m6", 6, "user"),
    makeMsg("m7", 7, "assistant"),
  ];
  const visible = listVisibleForDepth(all);

  it("startDepth=6 且 depth6 为 assistant 时从该 seq 起 hide", () => {
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 1);
    assert.equal(range.toSeq, 1);
  });

  it("startDepth=6 且 depth6 为 user 时校验 assistant 后返回 slice min~max", () => {
    const withUserAt6 = [
      makeMsg("m1", 1, "user"),
      makeMsg("m2", 2, "assistant"),
      makeMsg("m3", 3, "user"),
      makeMsg("m4", 4, "user"),
      makeMsg("m5", 5, "assistant"),
      makeMsg("m6", 6, "assistant"),
      makeMsg("m7", 7, "assistant"),
      makeMsg("m8", 8, "assistant"),
      makeMsg("m9", 9, "assistant"),
      makeMsg("m10", 10, "assistant"),
    ];
    const vis = listVisibleForDepth(withUserAt6);
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 1);
    assert.equal(range.toSeq, 4);
  });

  it("PRD：10 条可见 startDepth 6 时 range 覆盖 depth 6-9 全部", () => {
    const tenVisible = Array.from({ length: 10 }, (_, i) =>
      makeMsg(`m${i}`, i + 1, i % 2 === 0 ? "user" : "assistant"),
    );
    const vis = listVisibleForDepth(tenVisible);
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(vis, slice);
    assert.equal(ids.length, 4);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 1);
    assert.equal(range.toSeq, 4);
  });

  it("范围内无 assistant 时不 hide", () => {
    const onlyUsers = [
      makeMsg("u1", 1, "user"),
      makeMsg("u2", 2, "user"),
      makeMsg("u3", 3, "user"),
    ];
    const vis = listVisibleForDepth(onlyUsers);
    const slice = { startDepth: 1 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.equal(range, null);
  });

  it("有 endDepth 时仍用 slice 内 min~max seq", () => {
    const slice = { startDepth: 2, endDepth: 4 };
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 3);
    assert.equal(range.toSeq, 5);
  });

  it("T-CF1：fromSeq 边缘为 user(tool_result) 时向外扩展纳入配对 assistant(tool_use)", () => {
    const msgs = [
      makeMsg("m1", 1, "user"),
      makeMsg("m2", 2, "assistant", [
        { type: "tool_use", id: "t1", name: "read", input: {} },
      ]),
      makeMsg("m3", 3, "user", [
        { type: "tool_result", toolUseId: "t1", content: "ok" },
      ]),
      makeMsg("m4", 4, "assistant"),
      makeMsg("m5", 5, "user"),
      makeMsg("m6", 6, "assistant"),
      makeMsg("m7", 7, "user"),
    ];
    const vis = listVisibleForDepth(msgs);
    // n=7，depth 2..4 → seq 3..5：fromSeq 边缘 seq3 是 user(tool_result)，
    // 配对 assistant(tool_use t1) 在 seq2，应向外（更旧侧）扩展纳入。
    const slice = { startDepth: 2, endDepth: 4 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 2);
    assert.equal(range.toSeq, 5);
  });

  it("T-CF2：toSeq 边缘为 assistant(tool_use) 且 tool_result 在 range 外时向外扩展纳入", () => {
    const msgs = [
      makeMsg("m1", 1, "user"),
      makeMsg("m2", 2, "assistant"),
      makeMsg("m3", 3, "user"),
      makeMsg("m4", 4, "assistant", [
        { type: "tool_use", id: "t2", name: "read", input: {} },
      ]),
      makeMsg("m5", 5, "user", [
        { type: "tool_result", toolUseId: "t2", content: "ok" },
      ]),
      makeMsg("m6", 6, "assistant", [
        { type: "tool_use", id: "t3", name: "write", input: {} },
      ]),
      makeMsg("m7", 7, "user", [
        { type: "tool_result", toolUseId: "t3", content: "ok" },
      ]),
    ];
    const vis = listVisibleForDepth(msgs);
    // n=7，depth 1..3 → seq 4..6：toSeq 边缘 seq6 是 assistant(tool_use t3)，
    // 配对 tool_result 在 seq7（range 外更新侧），应向外（更新侧）扩展纳入。
    const slice = { startDepth: 1, endDepth: 3 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 4);
    assert.equal(range.toSeq, 7);
  });

  it("T-CF2b：toSeq 边缘为 assistant(tool_use) 但后续 user 只含其他 toolUseId 的 result 时不外扩", () => {
    const msgs = [
      makeMsg("m1", 1, "user"),
      makeMsg("m2", 2, "assistant"),
      makeMsg("m3", 3, "user"),
      makeMsg("m4", 4, "assistant"),
      makeMsg("m5", 5, "user"),
      makeMsg("m6", 6, "assistant", [
        { type: "tool_use", id: "t_x", name: "read", input: {} },
      ]),
      makeMsg("m7", 7, "user", [
        { type: "tool_result", toolUseId: "t_other", content: "ok" },
      ]),
    ];
    const vis = listVisibleForDepth(msgs);
    // n=7，depth 1..3 → seq 4..6：toSeq 边缘 seq6 是 assistant(tool_use t_x)，
    // 但后续 user 消息 seq7 只含其他 toolUseId（t_other）的 result，找不到
    // 配对（崩溃残留场景），不应外扩，toSeq 保持 6。
    const slice = { startDepth: 1, endDepth: 3 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 4);
    assert.equal(range.toSeq, 6);
  });

  it("T-CF3：无配对拆开时 range 与原行为完全一致（回归保护）", () => {
    // 全文本消息（无 tool blocks），扩展逻辑不应改变任何边界。
    const slice = { startDepth: 2, endDepth: 4 };
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 3);
    assert.equal(range.toSeq, 5);
  });

  it("T-CF3：配对消息不在 visible 列表内时保持原边界", () => {
    const msgs = [
      makeMsg("m1", 1, "user"),
      {
        ...makeMsg("m2", 2, "assistant", [
          { type: "tool_use", id: "t1", name: "read", input: {} },
        ]),
        hidden: true,
      },
      makeMsg("m3", 3, "user", [
        { type: "tool_result", toolUseId: "t1", content: "ok" },
      ]),
      makeMsg("m4", 4, "assistant"),
      makeMsg("m5", 5, "user"),
      makeMsg("m6", 6, "assistant"),
      makeMsg("m7", 7, "user"),
    ];
    const vis = listVisibleForDepth(msgs);
    // seq2 被 hidden 掉后 visible 为 6 条（seq1,3,4,5,6,7），depth 2..4 → seq 3..5；
    // fromSeq 边缘 seq3 是 user(tool_result)，但配对 assistant 不在 visible 内，
    // 应保持原边界（以 visible 列表为限）。
    const slice = { startDepth: 2, endDepth: 4 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 3);
    assert.equal(range.toSeq, 5);
  });

  it("T-CF4：全 user（含 tool_result）无 assistant 时仍返回 null", () => {
    const onlyUsers = [
      makeMsg("u1", 1, "user"),
      makeMsg("u2", 2, "user", [
        { type: "tool_result", toolUseId: "t9", content: "ok" },
      ]),
      makeMsg("u3", 3, "user"),
    ];
    const vis = listVisibleForDepth(onlyUsers);
    const slice = { startDepth: 0 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.equal(range, null);
  });
});
