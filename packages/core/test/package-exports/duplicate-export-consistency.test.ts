import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as compaction from "@novel-master/core/compaction";
import {
  matchDepth,
  validateDepthSlice,
} from "../../src/domain/depth/logic/depth-slice.js";

describe("重复 re-export 一致性", () => {
  it("compaction 子入口与 depth-slice 源同源", () => {
    assert.equal(compaction.matchDepth, matchDepth);
    assert.equal(compaction.validateDepthSlice, validateDepthSlice);
  });
});
