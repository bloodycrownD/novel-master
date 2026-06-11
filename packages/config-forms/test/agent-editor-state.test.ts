import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDefinitionFromForm,
  buildToolsPolicyFromSelection,
  formSnapshotJson,
  stripRemovedPromptBlocks,
  toolsSelectionFromDefinition,
} from "../src/agent/agent-editor-state.js";

test("buildToolsPolicyFromSelection returns undefined for default mode", () => {
  assert.equal(buildToolsPolicyFromSelection("default", ["read"]), undefined);
});

test("T8: buildToolsPolicyFromSelection builds allow/deny lists", () => {
  assert.deepEqual(buildToolsPolicyFromSelection("allow", ["read", "grep"]), {
    allow: ["read", "grep"],
  });
  assert.deepEqual(buildToolsPolicyFromSelection("deny", ["write"]), {
    deny: ["write"],
  });
});

test("T8: toolsSelectionFromDefinition round-trips policy modes", () => {
  assert.deepEqual(
    toolsSelectionFromDefinition({ name: "a", prompts: [], tools: { allow: ["read"] } }),
    { mode: "allow", selected: ["read"] },
  );
  assert.deepEqual(toolsSelectionFromDefinition({ name: "a", prompts: [] }), {
    mode: "default",
    selected: [],
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
    toolsSelected: [],
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
      toolsSelected: [],
      prompts: [],
    }).ok,
    false,
  );
});
