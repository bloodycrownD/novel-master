/**
 * 占用来源 → UI 标签映射的单测。
 *
 * 该映射此前在 desktop main service、desktop renderer 的 SessionDetailDrawer、
 * mobile service 三处各写一遍，改一处忘另两处就会出现「主进程标签与 chip
 * 打架」。本测试钉住 core 侧这份唯一事实来源，特别是 `undefined` 必须落到
 * 「预估」——宁可标保守，也不要给出「这是 API 真值」的假信号。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatTokenSourceLabel } from "../../../src/infra/tokenizer/logic/format-token-source-label.js";

describe("formatTokenSourceLabel", () => {
  it("api → 「上次请求」", () => {
    assert.equal(formatTokenSourceLabel("api"), "上次请求");
  });

  it("local → 「预估」", () => {
    assert.equal(formatTokenSourceLabel("local"), "预估");
  });

  it("undefined → 「预估」（未知取值一律不谎报为 API 真值）", () => {
    assert.equal(formatTokenSourceLabel(undefined), "预估");
  });
});
