import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchDepth,
  messageIdsInSlice,
  validateDepthSlice,
} from "../../src/domain/depth/logic/depth-slice.js";

describe("depth slice", () => {
  const ids = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"];

  it("only start-depth 6 hides depth 6-9", () => {
    const hit = messageIdsInSlice(
      ids.map((id, i) => ({ id, seq: i + 1 })),
      { startDepth: 6 },
    );
    assert.deepEqual(hit, ["m0", "m1", "m2", "m3"]);
  });

  it("start 0 end 99 hides all when fewer than 100 messages", () => {
    const hit = messageIdsInSlice(
      ids.map((id, i) => ({ id, seq: i + 1 })),
      { startDepth: 0, endDepth: 99 },
    );
    assert.equal(hit.length, 10);
  });

  it("only end-depth 2 hides depth 0-2", () => {
    const hit = messageIdsInSlice(
      ids.map((id, i) => ({ id, seq: i + 1 })),
      { endDepth: 2 },
    );
    assert.deepEqual(hit, ["m7", "m8", "m9"]);
  });

  it("only start-depth 0 hides all", () => {
    const hit = messageIdsInSlice(
      ids.map((id, i) => ({ id, seq: i + 1 })),
      { startDepth: 0 },
    );
    assert.equal(hit.length, 10);
  });

  it("matchDepth boundaries", () => {
    assert.equal(matchDepth(6, { startDepth: 6 }), true);
    assert.equal(matchDepth(5, { startDepth: 6 }), false);
    assert.equal(matchDepth(2, { endDepth: 2 }), true);
    assert.equal(matchDepth(3, { endDepth: 2 }), false);
  });

  it("rejects empty slice", () => {
    assert.throws(() => validateDepthSlice({}));
  });
});
