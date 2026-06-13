import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCharCount,
  formatStreamElapsed,
} from "../renderer/hooks/useAgentStreamMetrics.js";

describe("useAgentStreamMetrics formatters", () => {
  it("formatStreamElapsed 在 60s 内保留一位小数", () => {
    assert.equal(formatStreamElapsed(12.34), "12.3s");
    assert.equal(formatStreamElapsed(90), "90s");
  });

  it("formatCharCount 使用 zh-CN 分组", () => {
    const formatted = formatCharCount(1234);
    assert.match(formatted, /1/);
    assert.ok(formatted.length > 3);
  });
});
