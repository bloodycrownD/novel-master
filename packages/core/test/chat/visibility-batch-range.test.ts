/**
 * visibility-batch-range 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeHideRangeFromSelection,
  computeShowRangeFromSelection,
  computeVisibilityBatchAffectedIds,
  selectVisibilityBatchEligibleIdsFromAnchor,
} from "../../src/domain/chat/logic/visibility-batch-range.js";

const messages = [
  { id: "u1", role: "user", seq: 1 },
  { id: "a1", role: "assistant", seq: 2 },
  { id: "u2", role: "user", seq: 3 },
  { id: "a2", role: "assistant", seq: 4 },
  { id: "u3", role: "user", seq: 5 },
] as const;

describe("computeVisibilityBatchAffectedIds", () => {
  it("hide：选中 assistant 后包含 seq 上界以内的全部消息", () => {
    const selectedIds = new Set(["a1"]);
    const affected = computeVisibilityBatchAffectedIds(
      messages,
      "hide",
      selectedIds,
      5,
    );
    assert.equal(affected.size, 2);
    assert.ok(affected.has("u1"));
    assert.ok(affected.has("a1"));
    assert.ok(!affected.has("u2"));
    const range = computeHideRangeFromSelection(messages, selectedIds);
    assert.deepEqual(range, { fromSeq: 1, toSeq: 2 });
  });

  it("restore：选中 user 后包含 seq 下界及之后的全部消息", () => {
    const selectedIds = new Set(["u2"]);
    const affected = computeVisibilityBatchAffectedIds(
      messages,
      "restore",
      selectedIds,
      5,
    );
    assert.equal(affected.size, 3);
    assert.ok(affected.has("u2"));
    assert.ok(affected.has("a2"));
    assert.ok(affected.has("u3"));
    assert.ok(!affected.has("u1"));
    const range = computeShowRangeFromSelection(messages, selectedIds, 5);
    assert.deepEqual(range, { fromSeq: 3, toSeq: 5 });
  });

  it("hide 锚点：重置并勾选 seq 上界以内全部 assistant", () => {
    const ids = selectVisibilityBatchEligibleIdsFromAnchor(
      messages,
      "hide",
      "a2",
    );
    assert.deepEqual([...ids].sort(), ["a1", "a2"]);
  });

  it("restore 锚点：重置并勾选 seq 下界及之后全部 user", () => {
    const ids = selectVisibilityBatchEligibleIdsFromAnchor(
      messages,
      "restore",
      "u2",
    );
    assert.deepEqual([...ids].sort(), ["u2", "u3"]);
  });

  it("无有效选中时返回空集合", () => {
    assert.equal(
      computeVisibilityBatchAffectedIds(messages, "hide", new Set(), 5).size,
      0,
    );
    assert.equal(
      computeVisibilityBatchAffectedIds(
        messages,
        "restore",
        new Set(["a1"]),
        5,
      ).size,
      0,
    );
    assert.equal(
      computeVisibilityBatchAffectedIds(messages, null, new Set(["a1"]), 5)
        .size,
      0,
    );
  });
});
