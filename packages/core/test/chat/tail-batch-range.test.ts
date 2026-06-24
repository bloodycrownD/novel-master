/**
 * tail-batch-range 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTailBatchAffectedIds,
  computeTailBatchRangeFromSelection,
  selectTailBatchEligibleIdsFromAnchor,
  tailBatchDeleteAfterSeq,
} from "../../src/domain/chat/logic/tail-batch-range.js";

const rows = [
  { id: "u1", role: "user", seq: 1, selectable: true },
  { id: "a1", role: "assistant", seq: 2, selectable: true },
  { id: "u2", role: "user", seq: 3, selectable: true },
  { id: "a2", role: "assistant", seq: 4, selectable: true },
  { id: "card", role: "user", seq: 5, selectable: true },
  { id: "hidden", role: "assistant", seq: 6, selectable: true },
] as const;

describe("tail-batch-range", () => {
  it("restore 与 delete 同锚点产出相同勾选集", () => {
    const anchorIds = selectTailBatchEligibleIdsFromAnchor(rows, "u2");
    const anchorIdsAgain = selectTailBatchEligibleIdsFromAnchor(rows, "u2");
    assert.deepEqual([...anchorIds].sort(), [...anchorIdsAgain].sort());
    assert.deepEqual([...anchorIds].sort(), ["a2", "card", "hidden", "u2"]);
  });

  it("restore 与 delete 同选中集产出相同 affectedIds 与 range", () => {
    const selectedIds = new Set(["a1"]);
    const affected = computeTailBatchAffectedIds(rows, selectedIds, 5);
    const range = computeTailBatchRangeFromSelection(rows, selectedIds, 5);

    assert.equal(affected.size, 5);
    assert.ok(affected.has("a1"));
    assert.ok(affected.has("u2"));
    assert.ok(affected.has("a2"));
    assert.ok(affected.has("card"));
    assert.ok(affected.has("hidden"));
    assert.ok(!affected.has("u1"));
    assert.deepEqual(range, { fromSeq: 2, toSeq: 5 });
  });

  it("assistant 锚点可选并级联 seq 下界及之后全部可选行", () => {
    const ids = selectTailBatchEligibleIdsFromAnchor(rows, "a2");
    assert.deepEqual([...ids].sort(), ["a2", "card", "hidden"]);
  });

  it("hidden 行可作为 restore 锚点并级联其后可选行", () => {
    const ids = selectTailBatchEligibleIdsFromAnchor(rows, "hidden");
    assert.deepEqual([...ids].sort(), ["hidden"]);
  });

  it("不可选锚点返回空集", () => {
    const ineligible = [
      ...rows.slice(0, 5),
      { id: "locked", role: "user", seq: 7, selectable: false },
    ] as const;
    assert.equal(
      selectTailBatchEligibleIdsFromAnchor(ineligible, "locked").size,
      0,
    );
  });

  it("tailBatchDeleteAfterSeq(5) === 4", () => {
    assert.equal(tailBatchDeleteAfterSeq(5), 4);
  });

  it("无有效选中时返回空集合与 null range", () => {
    assert.equal(
      computeTailBatchAffectedIds(rows, new Set(), 5).size,
      0,
    );
    const ineligible = [
      { id: "locked", role: "user", seq: 7, selectable: false },
    ] as const;
    assert.equal(
      computeTailBatchRangeFromSelection(ineligible, new Set(["locked"]), 8),
      null,
    );
  });
});
