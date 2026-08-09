import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSavedModelId,
  resolveSummarySavedModelId,
} from "../../src/domain/agent/logic/resolve-saved-model-id.js";


describe("resolveSavedModelId（v2，无 workspace 回退）", () => {
  it("agent pin 优先", () => {
    assert.equal(
      resolveSavedModelId({
        agentModelId: "agent/pin",
        sessionModelId: "session/override",
      }),
      "agent/pin",
    );
  });

  it("无 agent pin 时回落 session", () => {
    assert.equal(
      resolveSavedModelId({ sessionModelId: "session/override" }),
      "session/override",
    );
  });

  it("agent + session 都空时返回 undefined（不再回退 workspace）", () => {
    assert.equal(resolveSavedModelId({}), undefined);
    assert.equal(resolveSavedModelId({ sessionModelId: undefined }), undefined);
  });

  it("session 为空时不影响 agent pin 生效", () => {
    assert.equal(
      resolveSavedModelId({
        agentModelId: "agent/pin",
        sessionModelId: undefined,
      }),
      "agent/pin",
    );
    // 纯函数严格走 ??：空串不视作「无覆盖」（归一化由调用方负责）。
    assert.equal(resolveSavedModelId({ sessionModelId: "" }), "");
  });
});

describe("resolveSummarySavedModelId", () => {
  it("summary pin 优先，否则 workspace（摘要仍读 workspace）", () => {
    assert.equal(
      resolveSummarySavedModelId({
        summaryModelId: "pin/model",
        workspaceModelId: "workspace/model",
      }),
      "pin/model",
    );
    assert.equal(
      resolveSummarySavedModelId({
        workspaceModelId: "workspace/model",
      }),
      "workspace/model",
    );
  });
});


