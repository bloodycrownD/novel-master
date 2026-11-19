import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  Random  } from "../../src/common/random.js";

describe("randomUUID", () => {
  it("returns RFC4122 v4 format", () => {
    const id = Random.uuid();
    assert.ok(Random.isUuidV4(id));
  });

  it("returns unique values across repeated calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(Random.uuid());
    }
    assert.equal(ids.size, 100);
  });
});
