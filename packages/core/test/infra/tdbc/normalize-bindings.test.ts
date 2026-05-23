import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeBindings } from "../../../src/infra/tdbc/normalize-bindings.js";

describe("normalizeBindings", () => {
  it("maps undefined to null", () => {
    assert.deepEqual(normalizeBindings([1, undefined, "x"]), [1, null, "x"]);
  });

  it("returns undefined for missing parameters", () => {
    assert.equal(normalizeBindings(undefined), undefined);
  });
});
