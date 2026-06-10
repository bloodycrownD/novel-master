import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareAppVersions } from "../../src/main/update-check/compare-app-versions.js";

describe("compareAppVersions", () => {
  it("returns -1 when local is older", () => {
    assert.equal(compareAppVersions("0.1.0", "0.2.0"), -1);
  });

  it("returns 0 when equal", () => {
    assert.equal(compareAppVersions("0.2.0", "0.2.0"), 0);
  });

  it("returns 1 when local is newer", () => {
    assert.equal(compareAppVersions("0.3.0", "0.2.9"), 1);
  });
});
