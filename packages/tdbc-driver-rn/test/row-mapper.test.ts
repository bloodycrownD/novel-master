import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowsFromResult } from "../src/row-mapper.js";

describe("rowsFromResult", () => {
  it("maps object rows", () => {
    const rows = rowsFromResult({
      rows: [{ id: 1, label: "x" }],
    });
    assert.deepEqual(rows, [{ id: 1, label: "x" }]);
  });

  it("maps array rows with columnNames", () => {
    const rows = rowsFromResult({
      columnNames: ["id", "label"],
      rows: [[2, "y"]],
    });
    assert.deepEqual(rows, [{ id: 2, label: "y" }]);
  });
});
