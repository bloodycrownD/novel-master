import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDefinitionFromForm,
  buildToolsPolicy,
  formSnapshotJson,
  stripRemovedPromptBlocks,
  toolsFromDefinition,
} from "../src/agent/agent-editor-state.js";

test("buildToolsPolicy returns undefined for default mode", () => {
  assert.equal(buildToolsPolicy("default", "read"), undefined);
});

test("buildToolsPolicy parses allow/deny lists", () => {
  assert.deepEqual(buildToolsPolicy("allow", "vfs.read, vfs.grep"), {
    allow: ["read", "grep"],
  });
  assert.deepEqual(buildToolsPolicy("deny", "write"), {
    deny: ["write"],
  });
});

test("toolsFromDefinition round-trips policy modes", () => {
  assert.deepEqual(
    toolsFromDefinition({ name: "a", prompts: [], tools: { allow: ["read"] } }),
    { mode: "allow", listText: "read" },
  );
  assert.deepEqual(toolsFromDefinition({ name: "a", prompts: [] }), {
    mode: "default",
    listText: "",
  });
});

test("stripRemovedPromptBlocks drops abstract blocks", () => {
  const result = stripRemovedPromptBlocks([
    { name: "a", type: "text", role: "system", content: "x" },
    { name: "b", type: "abstract" } as never,
  ]);
  assert.equal(result.removed, 1);
  assert.equal(result.prompts.length, 1);
});

test("formSnapshotJson omits model fields when disabled", () => {
  const json = formSnapshotJson({
    name: "agent",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "p",
    vendorModelId: "m",
    toolsMode: "default",
    toolsList: "",
    prompts: [{ name: "system", type: "text", role: "system", content: "" }],
  });
  const parsed = JSON.parse(json) as Record<string, unknown>;
  assert.equal(parsed.providerId, undefined);
  assert.equal(parsed.vendorModelId, undefined);
});

test("buildAgentDefinitionFromForm validates required fields", () => {
  assert.equal(
    buildAgentDefinitionFromForm({
      name: "",
      maxSteps: "20",
      modelEnabled: false,
      providerId: "",
      vendorModelId: "",
      toolsMode: "default",
      toolsList: "",
      prompts: [],
    }).ok,
    false,
  );
});
