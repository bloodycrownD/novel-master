import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeQuickSqliteBindings } from "../src/bindings.js";

describe("normalizeQuickSqliteBindings", () => {
  it("maps undefined to null and Uint8Array to ArrayBuffer", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const normalized = normalizeQuickSqliteBindings(["ref", bytes, undefined, 42])!;

    assert.equal(normalized[0], "ref");
    assert.ok(normalized[1] instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(normalized[1] as ArrayBuffer)], [1, 2, 3]);
    assert.equal(normalized[2], null);
    assert.equal(normalized[3], 42);
  });

  it("copies subarray views so bound buffer length matches blob bytes", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const view = backing.subarray(2, 5);
    const normalized = normalizeQuickSqliteBindings([view])!;

    const bound = normalized[0] as ArrayBuffer;
    assert.equal(bound.byteLength, 3);
    assert.deepEqual([...new Uint8Array(bound)], [1, 2, 3]);
    assert.notEqual(bound, view.buffer);
  });
});
