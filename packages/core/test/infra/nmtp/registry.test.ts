import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AssertionError } from "../../../src/common/assert.js";
import { TokenizerRegistry } from "../../../src/infra/nmtp/logic/registry.js";
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
  it("throws AssertionError when empty", () => {
    TokenizerRegistry.clear();
    assert.throws(
      () => TokenizerRegistry.resolve(),
      (e) =>
        e instanceof AssertionError &&
        e.message.includes("Tokenizer: no driver registered") &&
        e.message.includes("registerTokenizerNodeDriver"),
    );
  });

  it("resolves single registered driver", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    assert.equal(TokenizerRegistry.resolve().name, "node");
    TokenizerRegistry.clear();
  });

  it("throws AssertionError when more than one registered", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    TokenizerRegistry.register(stubDriver("rn"));
    assert.throws(
      () => TokenizerRegistry.resolve(),
      (e) => e instanceof AssertionError && e.message.includes("Tokenizer: 2 drivers registered (node, rn); specify driver name."),
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

  it("throws AssertionError for missing explicit name", () => {
    TokenizerRegistry.clear();
    TokenizerRegistry.register(stubDriver("node"));
    assert.throws(
      () => TokenizerRegistry.resolve("missing"),
      (e) => e instanceof AssertionError && e.message.includes("Tokenizer driver not registered: missing"),
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
