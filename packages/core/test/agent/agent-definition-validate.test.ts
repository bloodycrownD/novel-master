import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentDefinitionSchema,
  decode,
  validateAgentDefinition,
} from "@novel-master/core";

describe("validateAgentDefinition", () => {
  it("D2: assertSavedModel runs for valid model pin", async () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "pinned",
      prompts: { blocks: {} },
      model: "mock/test",
      },
      agentDefinitionSchema,
    );
    let seen = "";
    await validateAgentDefinition(def, {
      assertSavedModel: async (applicationModelId) => {
        seen = applicationModelId;
      },
    });
    assert.equal(seen, "mock/test");
  });

  it("D2: assertSavedModel failure rejects unknown pin", async () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "pinned",
      prompts: { blocks: {} },
      model: "mock/ghost",
      },
      agentDefinitionSchema,
    );
    await assert.rejects(
      () =>
        validateAgentDefinition(def, {
          assertSavedModel: async () => {
            throw new Error("unknown model: mock/ghost");
          },
        }),
      /unknown model: mock\/ghost/,
    );
  });

  it("skips assertSavedModel when model absent", async () => {
    const def = decode(
      {
        schemaVersion: 1,
        name: "bare",
      prompts: { blocks: {} },
      },
      agentDefinitionSchema,
    );
    let called = false;
    await validateAgentDefinition(def, {
      assertSavedModel: async () => {
        called = true;
      },
    });
    assert.equal(called, false);
  });
});
