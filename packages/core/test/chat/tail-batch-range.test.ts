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
  { id: "u1", role: "user", seq: 1, hidden: false, selectable: true },
  { id: "a1", role: "assistant", seq: 2, hidden: false, selectable: true },
  { id: "u2", role: "user", seq: 3, hidden: false, selectable: true },
  { id: "a2", role: "assistant", seq: 4, hidden: false, selectable: true },
  { id: "card", role: "user", seq: 5, hidden: false, selectable: true },
  { id: "hidden", role: "assistant", seq: 6, hidden: true, selectable: true },
] as const;

describe("tail-batch-range", () => {
  it("delete 锚点仅选未隐藏行并级联 seq 下界及之后", () => {
    const ids = selectTailBatchEligibleIdsFromAnchor(rows, "u2", "delete");
    assert.deepEqual([...ids].sort(), ["a2", "card", "u2"]);
    assert.ok(!ids.has("hidden"));
  });

  it("restore 锚点仅选已隐藏行并级联 seq 下界及之后", () => {
    const ids = selectTailBatchEligibleIdsFromAnchor(rows, "hidden", "restore");
    assert.deepEqual([...ids].sort(), ["hidden"]);
  });

  it("delete 与 restore 同选中集产出相同 affectedIds（含范围内 hidden）", () => {
    const selectedIds = new Set(["a1"]);
    const affected = computeTailBatchAffectedIds(rows, selectedIds, 6);

    assert.equal(affected.size, 5);
    assert.ok(affected.has("a1"));
    assert.ok(affected.has("u2"));
    assert.ok(affected.has("a2"));
    assert.ok(affected.has("card"));
    assert.ok(affected.has("hidden"));
    assert.ok(!affected.has("u1"));
  });

  it("delete 模式 range 仅计未隐藏选中", () => {
    const selectedIds = new Set(["a1"]);
    const range = computeTailBatchRangeFromSelection(
      rows,
      selectedIds,
      6,
      "delete",
    );
    assert.deepEqual(range, { fromSeq: 2, toSeq: 6 });
  });

  it("restore 模式 range 仅计已隐藏选中", () => {
    const selectedIds = new Set(["hidden"]);
    const range = computeTailBatchRangeFromSelection(
      rows,
      selectedIds,
      6,
      "restore",
    );
    assert.deepEqual(range, { fromSeq: 6, toSeq: 6 });
  });

  it("assistant delete 锚点级联其后未隐藏可选行", () => {
    const ids = selectTailBatchEligibleIdsFromAnchor(rows, "a2", "delete");
    assert.deepEqual([...ids].sort(), ["a2", "card"]);
  });

  it("hidden 行不可作 delete 锚点", () => {
    const ids = selectTailBatchEligibleIdsFromAnchor(rows, "hidden", "delete");
    assert.equal(ids.size, 0);
  });

  it("不可选锚点返回空集", () => {
    const ineligible = [
      ...rows.slice(0, 5),
      {
        id: "locked",
        role: "user",
        seq: 7,
        hidden: false,
        selectable: false,
      },
    ] as const;
    assert.equal(
      selectTailBatchEligibleIdsFromAnchor(ineligible, "locked", "delete").size,
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
      {
        id: "locked",
        role: "user",
        seq: 7,
        hidden: false,
        selectable: false,
      },
    ] as const;
    assert.equal(
      computeTailBatchRangeFromSelection(
        ineligible,
        new Set(["locked"]),
        8,
        "delete",
      ),
      null,
    );
  });
});
