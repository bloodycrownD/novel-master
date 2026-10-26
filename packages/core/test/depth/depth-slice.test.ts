import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type DepthSlice, matchDepth, messageIdsInSlice, validateDepthSlice } from "../../src/domain/depth/logic/depth-slice.js";

describe("depth slice", () => {
  const ids = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"];
  const visibleMessages = ids.map((id, i) => ({ id, seq: i + 1 }));
  const sliceIds = (slice: DepthSlice): string[] => {
    const r = messageIdsInSlice(visibleMessages, slice);
    assert.ok(r.ok);
    return r.value;
  };

  it("only start-depth 6 hides depth 6-9", () => {
    assert.deepEqual(sliceIds({ startDepth: 6 }), ["m0", "m1", "m2", "m3"]);
  });

  it("start 0 end 99 hides all when fewer than 100 messages", () => {
    assert.equal(sliceIds({ startDepth: 0, endDepth: 99 }).length, 10);
  });

  it("only end-depth 2 hides depth 0-2", () => {
    assert.deepEqual(sliceIds({ endDepth: 2 }), ["m7", "m8", "m9"]);
  });

  it("only start-depth 0 hides all", () => {
    assert.equal(sliceIds({ startDepth: 0 }).length, 10);
  });

  it("matchDepth boundaries", () => {
    assert.equal(matchDepth(6, { startDepth: 6 }), true);
    assert.equal(matchDepth(5, { startDepth: 6 }), false);
    assert.equal(matchDepth(2, { endDepth: 2 }), true);
    assert.equal(matchDepth(3, { endDepth: 2 }), false);
  });

  it("rejects invalid slices with DEPTH_INVALID_SLICE", () => {
    for (const slice of [{}, { startDepth: -1 }, { endDepth: 1.5 }, { startDepth: 3, endDepth: 2 }]) {
      const r = validateDepthSlice(slice);
      if (r.ok) assert.fail(`expected invalid slice: ${JSON.stringify(slice)}`);
      assert.equal(r.error.key, "DEPTH_INVALID_SLICE");
    }
  });
});
