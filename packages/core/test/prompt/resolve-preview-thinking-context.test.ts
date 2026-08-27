import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePreviewThinkingContext } from "../../src/service/prompt/resolve-preview-thinking-context.js";
import type { SavedModel } from "../../src/domain/provider/model/saved-model.js";
import type { LlmProvider } from "../../src/domain/provider/model/provider.js";
import type { ThinkingLevel } from "../../src/domain/provider/model/saved-model-settings.js";

function makeSaved(id: string, thinkingLevel: ThinkingLevel): SavedModel {
  return {
    id,
    providerId: "provider-custom",
    vendorModelId: `vendor-${id}`,
    modelName: id,
    settings: {
      schemaVersion: 2,
      internal: { contextWindowTokens: 8192, tokenCounterMode: "auto" },
      generation: { sampling: { enabled: false }, thinkingLevel },
    },
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

function makeProvider(protocol: LlmProvider["protocol"]): LlmProvider {
  return {
    id: "provider-custom",
    protocol,
    baseUrl: "https://example.invalid",
    displayName: "custom",
  } as unknown as LlmProvider;
}

describe("resolvePreviewThinkingContext", () => {
  it("取不到模型时兜底：requestThinkingEnabled true + protocol anthropic", async () => {
    const result = await resolvePreviewThinkingContext({
      preferences: { getThinkingContextEnabled: async () => true },
      savedModels: { findById: async () => null },
      providers: { findById: async () => null },
      agentModelId: undefined,
      sessionModelId: undefined,
    });
    assert.deepEqual(result, {
      enabled: true,
      requestThinkingEnabled: true,
      protocol: "anthropic",
    });
  });

  it("agent pin 优先于会话覆盖：档位按 pin 模型读取", async () => {
    const readIds: string[] = [];
    const result = await resolvePreviewThinkingContext({
      preferences: { getThinkingContextEnabled: async () => false },
      savedModels: {
        findById: async (id: string) => {
          readIds.push(id);
          return id === "m-agent" ? makeSaved("m-agent", "off") : null;
        },
      },
      providers: { findById: async () => makeProvider("openai") },
      agentModelId: "m-agent",
      sessionModelId: "m-session",
    });
    // 只读 pin 模型（档位与协议推断都不落会话覆盖），且 enabled 直通偏好值
    assert.ok(readIds.length > 0);
    assert.ok(readIds.every((id) => id === "m-agent"));
    assert.equal(result.enabled, false);
    assert.equal(result.requestThinkingEnabled, false);
    assert.equal(result.protocol, "openai");
  });

  it("档位 off → requestThinkingEnabled false（协议照常推断）", async () => {
    const result = await resolvePreviewThinkingContext({
      preferences: { getThinkingContextEnabled: async () => true },
      savedModels: {
        findById: async () => makeSaved("m-off", "off"),
      },
      providers: { findById: async () => makeProvider("gemini") },
      agentModelId: "m-off",
    });
    assert.equal(result.requestThinkingEnabled, false);
    assert.equal(result.protocol, "gemini");
  });
});
