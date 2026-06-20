import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as compaction from "@novel-master/core/compaction";
import * as cfEvents from "@novel-master/core/config-forms/events";
import * as cfShared from "@novel-master/core/config-forms/shared";
import * as nmtp from "@novel-master/core/nmtp";
import * as provider from "@novel-master/core/provider";

describe("重复 re-export 一致性", () => {
  it("depth slice 工具与 config-forms 同源", () => {
    assert.equal(compaction.matchDepth, cfEvents.matchDepth);
    assert.equal(compaction.validateDepthSlice, cfShared.validateDepthSlice);
  });

  it("registerTokenizerDriver 与 provider 子入口同源", () => {
    assert.equal(nmtp.registerTokenizerDriver, provider.registerTokenizerDriver);
  });
});
