import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareAppVersions } from "@novel-master/core/common";

describe("compareAppVersions", () => {
  it("returns -1 when local is older", () => {
    const cmp = compareAppVersions("0.1.0", "0.2.0");
    assert.ok(cmp.ok);
    assert.equal(cmp.value, -1);
  });

  it("returns 0 when equal", () => {
    const cmp = compareAppVersions("0.2.0", "0.2.0");
    assert.ok(cmp.ok);
    assert.equal(cmp.value, 0);
  });

  it("returns 1 when local is newer", () => {
    const cmp = compareAppVersions("0.3.0", "0.2.9");
    assert.ok(cmp.ok);
    assert.equal(cmp.value, 1);
  });
});
