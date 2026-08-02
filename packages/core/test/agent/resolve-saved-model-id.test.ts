import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSavedModelId,
  resolveSummarySavedModelId,
} from "../../src/domain/agent/logic/resolve-saved-model-id.js";
import { resolveApplicationModelId } from "../../src/domain/agent/logic/resolve-application-model-id.js";

describe("resolveSavedModelId", () => {
  it("R1: prefers agent model pin over workspace", () => {
    assert.equal(
      resolveSavedModelId({
        agentModelId: "mock/test",
        workspaceModelId: "openai/gpt-4",
      }),
      "mock/test",
    );
  });

  it("R1: falls back to workspace when agent pin absent", () => {
    assert.equal(
      resolveSavedModelId({ workspaceModelId: "openai/gpt-4" }),
      "openai/gpt-4",
    );
    assert.equal(resolveSavedModelId({}), undefined);
  });

  it("T-R1: agent pin > session > workspace 三档全优先级覆盖", () => {
    // agent pin 压制 session + workspace
    assert.equal(
      resolveSavedModelId({
        agentModelId: "agent/pin",
        sessionModelId: "session/override",
        workspaceModelId: "workspace/model",
      }),
      "agent/pin",
    );
    // 无 agent pin 时 session 压制 workspace
    assert.equal(
      resolveSavedModelId({
        sessionModelId: "session/override",
        workspaceModelId: "workspace/model",
      }),
      "session/override",
    );
    // session 与 agent 都缺时回退 workspace
    assert.equal(
      resolveSavedModelId({ workspaceModelId: "workspace/model" }),
      "workspace/model",
    );
    // 全空
    assert.equal(resolveSavedModelId({}), undefined);
  });

  it("T-R1: session 为空时不影响 agent pin 生效", () => {
    assert.equal(
      resolveSavedModelId({
        agentModelId: "agent/pin",
        sessionModelId: undefined,
        workspaceModelId: "workspace/model",
      }),
      "agent/pin",
    );
    // 纯函数严格走 ??：空串不视作「无覆盖」（与 workspaceModelId 同约束），
    // 空串→undefined 的归一化由调用方（resolveApplicationModelIdForRun）负责。
    assert.equal(
      resolveSavedModelId({
        sessionModelId: "",
        workspaceModelId: "workspace/model",
      }),
      "",
    );
  });
});

describe("resolveSummarySavedModelId", () => {
  it("T6: prefers summary pin, then workspace (not dialogue)", () => {
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

describe("resolveApplicationModelId (deprecated alias)", () => {
  it("delegates to resolveSavedModelId", () => {
    assert.equal(
      resolveApplicationModelId({ workspaceModelId: "openai/gpt-4" }),
      "openai/gpt-4",
    );
  });
});
