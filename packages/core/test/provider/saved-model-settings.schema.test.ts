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
  savedModelThinking,
} from "../../src/domain/provider/model/saved-model-settings.js";

describe("savedModelSettings schema", () => {
  it("v1 文档读入后升为 v2 内存形态且 thinking 默认关", () => {
    const settings = savedModelSettingsFromJson({
      schemaVersion: 1,
      contextWindowTokens: 128_000,
      sampling: { enabled: false },
    });
    assert.equal(settings.schemaVersion, 2);
    assert.equal(settings.internal.contextWindowTokens, 128_000);
    assert.equal(savedModelTokenCounterMode(settings), "auto");
    assert.equal(savedModelThinking(settings).enabled, false);
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

  it("写盘仅输出 v2", () => {
    const json = savedModelSettingsToJson(defaultSavedModelSettings("gpt-4o"));
    assert.equal(json.schemaVersion, 2);
    assert.ok("internal" in json);
    assert.ok("generation" in json);
  });
});
