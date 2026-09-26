import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composeStreamTokens,
  reanchorStreamTokenBase,
} from "../../../src/domain/format/stream-token-anchor.js";

/**
 * 「基线 + 增量」读值口径（stream-metrics-native ①，双端共用单点声明）。
 *
 * 这两个函数是 mobile 单元与 desktop hook 的**唯一**公式落点，行为等价性
 * 由下面两条恒等式锁死：谁再在本地内联一份算式、两边就会漂。
 */
describe("composeStreamTokens / reanchorStreamTokenBase（① 基线+增量口径单点）", () => {
  it("composeStreamTokens：负基线被夹到 0", () => {
    assert.equal(composeStreamTokens(-5, 3), 0);
    // 夹负前的和为负才夹——和为正 / 为 0 时原样透出。
    assert.equal(composeStreamTokens(-3, 3), 0);
    assert.equal(composeStreamTokens(0, 0), 0);
    assert.equal(composeStreamTokens(10, 5), 15);
    assert.equal(composeStreamTokens(-10, 25), 15);
  });

  it("reanchorStreamTokenBase：重锚恒等式 compose(reanchor(t, i), i) === max(0, t)", () => {
    for (const [truth, increment] of [
      [0, 0],
      [120, 37],
      [5, 5],
      [3, 9], // 真值比已累计增量还小：重锚后基线为负，夹负兜住
      [-10, 4], // 真值本身为负（防御性输入）：读值仍是 0
    ] as const) {
      assert.equal(
        composeStreamTokens(reanchorStreamTokenBase(truth, increment), increment),
        Math.max(0, truth),
        `truth=${truth} increment=${increment}`,
      );
    }
  });
});
