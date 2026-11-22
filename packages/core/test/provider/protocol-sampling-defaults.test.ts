import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  ProtocolSamplingDefaults, OPENAI_SAMPLING_DEFAULTS  } from "@novel-master/core/provider";

describe("mergeSamplingWithDefaults", () => {
    it("fills openai defaults when params missing", () => {
        const merged = ProtocolSamplingDefaults.mergeSamplingWithDefaults("openai", undefined);
        assert.equal(merged.protocol, "openai");
        if (merged.protocol === "openai") {
            assert.equal(merged.openai.temperature, OPENAI_SAMPLING_DEFAULTS.temperature);
            assert.equal(merged.openai.max_tokens, OPENAI_SAMPLING_DEFAULTS.max_tokens);
        }
    });

    it("overrides defaults with saved values", () => {
        const merged = ProtocolSamplingDefaults.mergeSamplingWithDefaults("openai", {
            protocol: "openai",
            openai: { temperature: 0.3 },
        });
        if (merged.protocol === "openai") {
            assert.equal(merged.openai.temperature, 0.3);
            assert.equal(merged.openai.max_tokens, OPENAI_SAMPLING_DEFAULTS.max_tokens);
        }
    });
});

describe("maxOutputTokensFromSampling", () => {
    it("reads max_tokens from effective openai params", () => {
        const merged = ProtocolSamplingDefaults.mergeSamplingWithDefaults("openai", undefined);
        assert.equal(ProtocolSamplingDefaults.maxOutputTokensFromSampling(merged), 16_000);
    });
});
