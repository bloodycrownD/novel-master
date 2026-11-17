import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenizerRegistry } from "../../../src/infra/nmtp/logic/registry.js";
import { TokenizerError } from "../../../src/infra/nmtp/nmtp-error.js";
import type { TokenizerDriver } from "../../../src/infra/nmtp/ports/tokenizer-driver.port.js";

function stubDriver(name: string): TokenizerDriver {
  return {
    name,
    async countPromptLlmInput() {
      return {
        tokenCount: 0,
        counterKind: "heuristic",
        estimated: true,
        savedModelId: "openai/gpt-4o",
        vendorModelId: "gpt-4o",
        tokenizerFamily: "tiktoken",
      };
    },
  };
}

describe("NMTP registry", () => {
  it("throws NOT_REGISTERED when empty", () => {
    TokenizerRegistry.clear();
    assert.throws(
      () => TokenizerRegistry.resolve(),
      (e) =>
        e instanceof TokenizerError &&
        e.code === "NOT_REGISTERED" &&
        e.message.includes("registerTokenizerNodeDriver"),
    );
  });

  it("resolves single registered driver", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    assert.equal(TokenizerRegistry.resolve().name, "node");
    TokenizerRegistry.clear();
  });

  it("throws MULTIPLE_DRIVERS when more than one registered", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    TokenizerRegistry.register(stubDriver("rn"));
    assert.throws(
      () => TokenizerRegistry.resolve(),
      (e) => e instanceof TokenizerError && e.code === "MULTIPLE_DRIVERS",
    );
    TokenizerRegistry.clear();
  });

  it("resolves explicit driver by name", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    TokenizerRegistry.register(stubDriver("rn"));
    assert.equal(TokenizerRegistry.resolve("rn").name, "rn");
    TokenizerRegistry.clear();
  });

  it("throws NOT_REGISTERED for missing explicit name", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    assert.throws(
      () => TokenizerRegistry.resolve("missing"),
      (e) => e instanceof TokenizerError && e.code === "NOT_REGISTERED",
    );
    TokenizerRegistry.clear();
  });

  it("TokenizerRegistry.get returns undefined for unknown name", () => {
    TokenizerRegistry.clear();
    assert.equal(TokenizerRegistry.get("node"), undefined);
  });

  it("TokenizerRegistry.clear empties registry", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    TokenizerRegistry.clear();
    assert.throws(() => TokenizerRegistry.resolve());
  });
});
