import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRandomUuidV4, randomUUID } from "../../src/infra/random-uuid.js";

describe("randomUUID", () => {
  it("returns RFC4122 v4 format", () => {
    const id = randomUUID();
    assert.ok(isRandomUuidV4(id));
  });

  it("returns unique values across repeated calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(randomUUID());
    }
    assert.equal(ids.size, 100);
  });
});
