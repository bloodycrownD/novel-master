import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentDefinitionFromJson,
  validateAgentDefinition,
} from "@novel-master/core";

describe("validateAgentDefinition", () => {
  it("D2: assertSavedModel runs for valid preferredModelId pin", async () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "pinned",
      prompts: { blocks: [] },
      preferredModelId: "mock/test",
    });
    let seen = "";
    await validateAgentDefinition(def, {
      assertSavedModel: async (applicationModelId) => {
        seen = applicationModelId;
      },
    });
    assert.equal(seen, "mock/test");
  });

  it("D2: assertSavedModel failure rejects unknown pin", async () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "pinned",
      prompts: { blocks: [] },
      preferredModelId: "mock/ghost",
    });
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

  it("skips assertSavedModel when preferredModelId absent", async () => {
    const def = agentDefinitionFromJson({
      schemaVersion: 1,
      name: "bare",
      prompts: { blocks: [] },
    });
    let called = false;
    await validateAgentDefinition(def, {
      assertSavedModel: async () => {
        called = true;
      },
    });
    assert.equal(called, false);
  });
});
