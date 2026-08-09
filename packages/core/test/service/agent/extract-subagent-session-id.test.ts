import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractSubagentSessionIdFromOutcome } from "@/service/agent/impl/agent-runner.js";

/**
 * T-A5（phase-1-abort-reflow）：固化 `extractSubagentSessionIdFromOutcome` 在
 * 中断回流场景下仍是 no-op——它只看 outcome.ok 与 output.subagentSessionId，
 * 不看 stopped。中断回流 output（stopped=true）同样带 subagentSessionId，
 * 应被同一路径提取，防止后续重构里有人加 `&& !output.stopped` 之类判断误删回流。
 */
describe("extractSubagentSessionIdFromOutcome 中断回流 no-op 固化（T-A5）", () => {
  it("output.stopped=true 且含 subagentSessionId → 返回该 subagentSessionId", () => {
    const sid = extractSubagentSessionIdFromOutcome({
      ok: true,
      output: {
        text: "[用户停止，无已生成文本]",
        subagentSessionId: "child-cancelled",
        stopped: true,
        failureReason: "用户停止",
      },
    });
    assert.equal(sid, "child-cancelled");
  });

  it("正常完成（无 stopped）仍返回 subagentSessionId（回归）", () => {
    const sid = extractSubagentSessionIdFromOutcome({
      ok: true,
      output: { text: "done", subagentSessionId: "child-ok" },
    });
    assert.equal(sid, "child-ok");
  });

  it("outcome.ok=false 时一律返回 undefined（不读 output）", () => {
    const sid = extractSubagentSessionIdFromOutcome({
      ok: false,
      error: new Error("boom"),
    });
    assert.equal(sid, undefined);
  });

  it("output 无 subagentSessionId 时返回 undefined", () => {
    const sid = extractSubagentSessionIdFromOutcome({
      ok: true,
      output: { version: 1 },
    });
    assert.equal(sid, undefined);
  });

  it("output.subagentSessionId 非 string 时返回 undefined", () => {
    const sid = extractSubagentSessionIdFromOutcome({
      ok: true,
      output: { subagentSessionId: 123 },
    });
    assert.equal(sid, undefined);
  });
});
