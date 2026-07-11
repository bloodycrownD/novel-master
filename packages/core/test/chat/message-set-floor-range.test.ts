/**
 * message-set-floor-range 单测。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeSetFloorRanges,
  isSetFloorAnchorRole,
} from "../../src/domain/chat/logic/message-set-floor-range.js";

describe("message-set-floor-range", () => {
  it("T-SF1：N=1 仅 showSuffix", () => {
    assert.equal(isSetFloorAnchorRole("user"), true);
    assert.equal(isSetFloorAnchorRole("assistant"), true);
    assert.equal(isSetFloorAnchorRole("system"), false);

    const ranges = computeSetFloorRanges(1, 5);
    assert.equal(ranges.hidePrefix, null);
    assert.deepEqual(ranges.showSuffix, { fromSeq: 1, toSeq: 5 });
  });

  it("T-SF2：N=M 仅 hidePrefix", () => {
    const ranges = computeSetFloorRanges(5, 5);
    assert.deepEqual(ranges.hidePrefix, { fromSeq: 1, toSeq: 4 });
    assert.equal(ranges.showSuffix, null);
  });

  it("T-SF3：中间 N 同时 hide+show", () => {
    const ranges = computeSetFloorRanges(3, 5);
    assert.deepEqual(ranges.hidePrefix, { fromSeq: 1, toSeq: 2 });
    assert.deepEqual(ranges.showSuffix, { fromSeq: 3, toSeq: 5 });
  });

  it("空操作边界：N > sessionMaxSeq 无 showSuffix", () => {
    const ranges = computeSetFloorRanges(6, 5);
    assert.deepEqual(ranges.hidePrefix, { fromSeq: 1, toSeq: 5 });
    assert.equal(ranges.showSuffix, null);
  });

  it("空操作边界：N=1 且 sessionMaxSeq=0 无区间", () => {
    const ranges = computeSetFloorRanges(1, 0);
    assert.equal(ranges.hidePrefix, null);
    assert.equal(ranges.showSuffix, null);
  });
});
