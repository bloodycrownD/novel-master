import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  TdbcBindings  } from "@/infra/tdbc/logic/normalize-bindings.js";

describe("normalizeBindings", () => {
  it("maps undefined to null", () => {
    assert.deepEqual(TdbcBindings.normalize([1, undefined, "x"]), [1, null, "x"]);
  });

  it("returns undefined for missing parameters", () => {
    assert.equal(TdbcBindings.normalize(undefined), undefined);
  });
});
