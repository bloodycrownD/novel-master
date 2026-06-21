import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as compaction from "@novel-master/core/compaction";
import * as cfEvents from "@novel-master/core/config-forms/events";
import * as cfShared from "@novel-master/core/config-forms/shared";

describe("重复 re-export 一致性", () => {
  it("depth slice 工具与 config-forms 同源", () => {
    assert.equal(compaction.matchDepth, cfEvents.matchDepth);
    assert.equal(compaction.validateDepthSlice, cfShared.validateDepthSlice);
  });
});
