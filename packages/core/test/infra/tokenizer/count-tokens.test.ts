import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countTokens } from "../../../src/infra/tokenizer/logic/count-tokens.js";

/** 可预测的 mock 编码器：token 数 = 文本长度，便于断言包装开销。 */
const lenEncode = (text: string): number => text.length;

describe("countTokens", () => {
  it("heuristic 档：固定 +3/+3，只 encode content", () => {
    // 每条消息 +3，encode content，尾部 +3。role 不参与计数。
    const count = countTokens(
      lenEncode,
      [{ role: "system", content: "abc" }],
      "heuristic",
    );
    assert.equal(count, 3 + 3 + 3);
  });

  it("heuristic 档：多条消息累加，name 字段被忽略", () => {
    const count = countTokens(
      lenEncode,
      [
        { role: "system", content: "ab" },
        { role: "user", content: "cde", name: "ignored" },
      ],
      "heuristic",
    );
    // (3 + 2) + (3 + 3) + 3 = 14
    assert.equal(count, 14);
  });

  it("precise 档非 0301：每条 +3，encode role+content，尾部 +3", () => {
    const count = countTokens(
      lenEncode,
      [{ role: "r", content: "abc" }],
      "precise",
    );
    // 3 + encode("r") + encode("abc") + 3 = 3 + 1 + 3 + 3 = 10
    assert.equal(count, 10);
  });

  it("precise 档非 0301：name 字段额外 encode 并 +1", () => {
    const count = countTokens(
      lenEncode,
      [{ role: "r", content: "abc", name: "nn" }],
      "precise",
    );
    // 3 + 1 + 3 + 2 + 1(perName) + 3 = 13
    assert.equal(count, 13);
  });

  it("precise 档 0301：每条 +4，name -1，尾部 +3+9", () => {
    const count = countTokens(
      lenEncode,
      [{ role: "r", content: "abc", name: "nn" }],
      "precise",
      { tiktokenModel: "gpt-3.5-turbo-0301" },
    );
    // 4 + 1 + 3 + 2 + (-1) + 3 + 9 = 21
    assert.equal(count, 21);
  });

  it("precise 档省略 tiktokenModel 时按非 0301 处理", () => {
    const count = countTokens(
      lenEncode,
      [{ role: "r", content: "abc" }],
      "precise",
    );
    assert.equal(count, 10);
  });

  it("空消息列表：heuristic 仅尾部 +3，precise 仅尾部 +3", () => {
    assert.equal(countTokens(lenEncode, [], "heuristic"), 3);
    assert.equal(countTokens(lenEncode, [], "precise"), 3);
  });
});
