import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearTokenizerDrivers,
  getTokenizerDriver,
  registerTokenizerDriver,
  resolveTokenizerDriver,
} from "../../../src/infra/nmtp/logic/registry.js";
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
    clearTokenizerDrivers();
    assert.throws(
      () => resolveTokenizerDriver(),
      (e) =>
        e instanceof TokenizerError &&
        e.code === "NOT_REGISTERED" &&
        e.message.includes("registerTokenizerNodeDriver"),
    );
  });

  it("resolves single registered driver", () => {
    clearTokenizerDrivers();
    registerTokenizerDriver(stubDriver("node"));
    assert.equal(resolveTokenizerDriver().name, "node");
    clearTokenizerDrivers();
  });

  it("throws MULTIPLE_DRIVERS when more than one registered", () => {
    clearTokenizerDrivers();
    registerTokenizerDriver(stubDriver("node"));
    registerTokenizerDriver(stubDriver("rn"));
    assert.throws(
      () => resolveTokenizerDriver(),
      (e) => e instanceof TokenizerError && e.code === "MULTIPLE_DRIVERS",
    );
    clearTokenizerDrivers();
  });

  it("resolves explicit driver by name", () => {
    clearTokenizerDrivers();
    registerTokenizerDriver(stubDriver("node"));
    registerTokenizerDriver(stubDriver("rn"));
    assert.equal(resolveTokenizerDriver("rn").name, "rn");
    clearTokenizerDrivers();
  });

  it("throws NOT_REGISTERED for missing explicit name", () => {
    clearTokenizerDrivers();
    registerTokenizerDriver(stubDriver("node"));
    assert.throws(
      () => resolveTokenizerDriver("missing"),
      (e) => e instanceof TokenizerError && e.code === "NOT_REGISTERED",
    );
    clearTokenizerDrivers();
  });

  it("getTokenizerDriver returns undefined for unknown name", () => {
    clearTokenizerDrivers();
    assert.equal(getTokenizerDriver("node"), undefined);
  });

  it("clearTokenizerDrivers empties registry", () => {
    clearTokenizerDrivers();
    registerTokenizerDriver(stubDriver("node"));
    clearTokenizerDrivers();
    assert.throws(() => resolveTokenizerDriver());
  });
});
