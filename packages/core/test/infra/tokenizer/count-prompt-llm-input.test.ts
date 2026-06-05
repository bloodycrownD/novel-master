import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { registerNodeTokenizerDriverForTests } from "../../helpers/register-node-tokenizer-driver-for-tests.js";
import {
  clearTokenizerDrivers,
  countPromptLlmInput,
  createDefaultTokenCounterRegistry,
  TokenizerError,
} from "../../../src/infra/tokenizer/index.js";
import { emptyRegistryDeps } from "./registry-test-helpers.js";

const minimalParams = {
  input: { messages: [] },
  applicationModelId: "openai/gpt-4o",
  registry: createDefaultTokenCounterRegistry(emptyRegistryDeps()),
} as const;

describe("countPromptLlmInput", () => {
  after(() => {
    registerNodeTokenizerDriverForTests();
  });

  it("throws NOT_REGISTERED when no NMTP driver is registered", async () => {
    clearTokenizerDrivers();
    await assert.rejects(
      () => countPromptLlmInput(minimalParams),
      (e) =>
        e instanceof TokenizerError &&
        e.code === "NOT_REGISTERED" &&
        e.message.includes("registerTokenizerNodeDriver"),
    );
  });
});
