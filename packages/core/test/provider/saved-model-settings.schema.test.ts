import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../src/errors/provider-errors.js";
import {
  savedModelSettingsFromJson,
  savedModelSettingsToJson,
} from "../../src/domain/provider/model/saved-model-settings-from-json.js";
import { defaultSavedModelSettings } from "../../src/domain/provider/model/default-saved-model-settings.js";
import {
  savedModelTokenCounterMode,
  savedModelThinkingLevel,
} from "../../src/domain/provider/model/saved-model-settings.js";

describe("savedModelSettings schema", () => {
  it("v1 文档读入后升为 v2 内存形态且 thinkingLevel 默认关", () => {
    const settings = savedModelSettingsFromJson({
      schemaVersion: 1,
      contextWindowTokens: 128_000,
      sampling: { enabled: false },
    });
    assert.equal(settings.schemaVersion, 2);
    assert.equal(settings.internal.contextWindowTokens, 128_000);
    assert.equal(savedModelTokenCounterMode(settings), "auto");
    assert.equal(savedModelThinkingLevel(settings), "off");
  });

  it("缺失 tokenCounterMode 时默认为 auto", () => {
    const settings = savedModelSettingsFromJson({
      schemaVersion: 1,
      contextWindowTokens: 128_000,
      sampling: { enabled: false },
    });
    assert.equal(savedModelTokenCounterMode(settings), "auto");
  });

  it("拒绝无效 tokenCounterMode", () => {
    assert.throws(
      () =>
        savedModelSettingsFromJson({
          schemaVersion: 1,
          contextWindowTokens: 128_000,
          sampling: { enabled: false },
          tokenCounterMode: "not-a-mode",
        }),
      (e) => e instanceof ProviderError && e.code === "INVALID_ARGUMENT",
    );
  });

  it("v2 文档 round-trip tokenCounterMode", () => {
    const defaults = defaultSavedModelSettings("gpt-4o");
    const settings = {
      ...defaults,
      internal: { ...defaults.internal, tokenCounterMode: "gemma" as const },
    };
    const json = savedModelSettingsToJson(settings);
    assert.equal(json.schemaVersion, 2);
    assert.equal(json.internal.tokenCounterMode, "gemma");
    const parsed = savedModelSettingsFromJson(json);
    assert.equal(savedModelTokenCounterMode(parsed), "gemma");
  });

  it("写盘仅输出 v2，新建默认 thinkingLevel 为高", () => {
    const json = savedModelSettingsToJson(defaultSavedModelSettings("gpt-4o"));
    assert.equal(json.schemaVersion, 2);
    assert.ok("internal" in json);
    assert.ok("generation" in json);
    assert.equal(json.generation.thinkingLevel, "high");
  });

  it("v2 缺 thinkingLevel 时默认为 off", () => {
    const settings = savedModelSettingsFromJson({
      schemaVersion: 2,
      internal: {
        contextWindowTokens: 128_000,
        tokenCounterMode: "auto",
      },
      generation: {
        sampling: { enabled: false },
      },
    });
    assert.equal(savedModelThinkingLevel(settings), "off");
  });

  it("dev-only：旧 thinking.enabled 映射为 thinkingLevel", () => {
    const settings = savedModelSettingsFromJson({
      schemaVersion: 2,
      internal: {
        contextWindowTokens: 128_000,
        tokenCounterMode: "auto",
      },
      generation: {
        sampling: { enabled: false },
        thinking: { enabled: true },
      },
    });
    assert.equal(savedModelThinkingLevel(settings), "medium");

    const off = savedModelSettingsFromJson({
      schemaVersion: 2,
      internal: {
        contextWindowTokens: 128_000,
        tokenCounterMode: "auto",
      },
      generation: {
        sampling: { enabled: false },
        thinking: { enabled: false },
      },
    });
    assert.equal(savedModelThinkingLevel(off), "off");
  });

  it("v2 round-trip thinkingLevel", () => {
    const defaults = defaultSavedModelSettings("gpt-4o");
    const settings = {
      ...defaults,
      generation: { ...defaults.generation, thinkingLevel: "high" as const },
    };
    const parsed = savedModelSettingsFromJson(savedModelSettingsToJson(settings));
    assert.equal(savedModelThinkingLevel(parsed), "high");
  });
});
