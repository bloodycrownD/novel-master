import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveApplicationModelId, resolveSummaryApplicationModelId } from "@novel-master/core/agent";

describe("resolveApplicationModelId (deprecated alias)", () => {
  it("agent model pin 优先", () => {
    assert.equal(
      resolveApplicationModelId({
        agentModelId: "mock/test",
      }),
      "mock/test",
    );
  });

  it("agent pin 缺失时返回 undefined（不再回退 workspace）", () => {
    // workspaceModelId 已从入参中移除；TS 侧老调用如果不传，行为变成 undefined。
    // 这里只验证 agent pin 缺失 → undefined。
    assert.equal(resolveApplicationModelId({}), undefined);
  });
});

describe("resolveSummaryApplicationModelId", () => {
  it("summary pin 优先，否则 workspace（摘要仍读 workspace）", () => {
    assert.equal(
      resolveSummaryApplicationModelId({
        summaryModelId: "pin/model",
        workspaceModelId: "workspace/model",
      }),
      "pin/model",
    );
    assert.equal(
      resolveSummaryApplicationModelId({
        workspaceModelId: "workspace/model",
      }),
      "workspace/model",
    );
  });
});
