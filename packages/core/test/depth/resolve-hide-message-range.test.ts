/**
 * resolve-hide-message-range 单测。
 *
 * 最终口径：`startDepth` 是启发式起点，从 slice 最新边界向更旧方向找第一条
 * 真用户输入（user 且非 tool_result），只隐藏严格更旧的消息；锚点起的整轮
 * 保持可见，压缩后可见历史以 user 开头且条数 ≥ startDepth+1（可以超出 6）。
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
  // 协议约束：会话消息严格 user/assistant 交替且以 user 开头。
  const all = [
    makeMsg("m1", 1, "user"),
    makeMsg("m2", 2, "assistant"),
    makeMsg("m3", 3, "user"),
    makeMsg("m4", 4, "assistant"),
    makeMsg("m5", 5, "user"),
    makeMsg("m6", 6, "assistant"),
    makeMsg("m7", 7, "user"),
  ];
  const visible = listVisibleForDepth(all);

  it("PRD：10 条可见 startDepth 6 时隐藏锚点以旧，保留 8 条", () => {
    const tenVisible = Array.from({ length: 10 }, (_, i) =>
      makeMsg(`m${i}`, i + 1, i % 2 === 0 ? "user" : "assistant"),
    );
    const vis = listVisibleForDepth(tenVisible);
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(vis, slice);
    assert.equal(ids.length, 4);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    // 边界 seq4 是 assistant，向旧走到 seq3 真用户输入，隐藏 1..2；
    // 保留 seq3..seq10 共 8 条（≥ 7），可见开头为 user。
    assert.equal(range.fromSeq, 1);
    assert.equal(range.toSeq, 2);
  });

  it("T-CF1：边界切断轮次时向旧锚定，锚点整轮保留（复刻 Metro 场景）", () => {
    const msgs = [
      makeMsg("m1", 1, "user"),
      makeMsg("m2", 2, "assistant"),
      makeMsg("m3", 3, "user"),
      makeMsg("m4", 4, "assistant", [
        { type: "tool_use", id: "t1", name: "read", input: {} },
      ]),
      makeMsg("m5", 5, "user", [
        { type: "tool_result", toolUseId: "t1", content: "ok" },
      ]),
      makeMsg("m6", 6, "assistant", [
        { type: "tool_use", id: "t2", name: "read", input: {} },
      ]),
      makeMsg("m7", 7, "user", [
        { type: "tool_result", toolUseId: "t2", content: "ok" },
      ]),
      makeMsg("m8", 8, "assistant"),
      makeMsg("m9", 9, "user"),
      makeMsg("m10", 10, "assistant"),
      makeMsg("m11", 11, "user"),
      makeMsg("m12", 12, "assistant"),
    ];
    const vis = listVisibleForDepth(msgs);
    // n=12，startDepth=6 → seq ≤ 6；边界切在轮中段（seq4..8 是同一轮的
    // tool 往返）。向旧锚定到 seq3 真用户输入，只隐藏 1..2；保留
    // seq3..seq12，可见开头 = user, assistant(tool_use), user(tool_result),
    // …——用户期望的「user assistant tool call tool result」形态。
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 1);
    assert.equal(range.toSeq, 2);
  });

  it("T-CF2：边界恰落在真用户输入上时隐藏其以旧全部", () => {
    const msgs = [
      makeMsg("m1", 1, "user"),
      makeMsg("m2", 2, "assistant"),
      makeMsg("m3", 3, "user"),
      makeMsg("m4", 4, "assistant"),
      makeMsg("m5", 5, "user"),
      makeMsg("m6", 6, "assistant"),
      makeMsg("m7", 7, "user"),
      makeMsg("m8", 8, "assistant"),
      makeMsg("m9", 9, "user"),
      makeMsg("m10", 10, "assistant"),
      makeMsg("m11", 11, "user"),
      makeMsg("m12", 12, "assistant"),
    ];
    const vis = listVisibleForDepth(msgs);
    // n=12，startDepth=3 → seq ≤ 9；seq9 恰为真用户输入，锚点即边界，
    // 隐藏 1..8，保留 9..12。
    const slice = { startDepth: 3 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 1);
    assert.equal(range.toSeq, 8);
  });

  it("T-CF3：bounded slice 同规则，隐藏区间止于锚点前一条", () => {
    // n=7，depth 2..4 → seq 3..5；seq5 是真用户输入 → 隐藏 3..4。
    const slice = { startDepth: 2, endDepth: 4 };
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.ok(range);
    assert.equal(range.fromSeq, 3);
    assert.equal(range.toSeq, 4);
  });

  it("T-CF4：锚点即 slice 最老消息时无可隐藏，返回 null", () => {
    // n=7，startDepth=6 → 仅 seq1（user）命中；锚点=最老候选，没有更旧的
    // 可隐藏，跳过本次压缩。
    const slice = { startDepth: 6 };
    const ids = messageIdsInSlice(visible, slice);
    const range = resolveHideMessageRange(visible, slice, ids);
    assert.equal(range, null);
  });

  it("T-CF5：slice 内无真用户输入（病态残留）时不触发压缩", () => {
    const msgs = [
      makeMsg("m1", 1, "user", [
        { type: "tool_result", toolUseId: "t0", content: "ok" },
      ]),
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
      makeMsg("m8", 8, "assistant"),
      makeMsg("m9", 9, "user"),
    ];
    const vis = listVisibleForDepth(msgs);
    // n=9，depth 5..8 → seq 1..4：范围内只有 tool 往返和 assistant，
    // 找不到真用户输入（seq1 真用户输入已隐藏的病态残留形态）——
    // 放弃压缩返回 null，避免压缩后可见历史以 assistant 开头。
    const slice = { startDepth: 5, endDepth: 8 };
    const ids = messageIdsInSlice(vis, slice);
    const range = resolveHideMessageRange(vis, slice, ids);
    assert.equal(range, null);
  });
});
