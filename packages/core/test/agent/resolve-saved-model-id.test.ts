import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSavedModelId } from "../../src/domain/agent/logic/resolve-saved-model-id.js";

describe("resolveSavedModelId（v2，无 workspace 回退）", () => {
  it("agent pin 优先", () => {
    assert.equal(resolveSavedModelId("agent/pin", "session/override"), "agent/pin");
  });

  it("无 agent pin 时回落 session", () => {
    assert.equal(resolveSavedModelId(undefined, "session/override"), "session/override");
  });

  it("agent + session 都空时返回 undefined（不再回退 workspace）", () => {
    assert.equal(resolveSavedModelId(), undefined);
    assert.equal(resolveSavedModelId(undefined, undefined), undefined);
  });

  it("session 为空时不影响 agent pin 生效", () => {
    assert.equal(resolveSavedModelId("agent/pin", undefined), "agent/pin");
    // 纯函数严格走 ??：空串不视作「无覆盖」（归一化由调用方负责）。
    assert.equal(resolveSavedModelId(undefined, ""), "");
  });
});
