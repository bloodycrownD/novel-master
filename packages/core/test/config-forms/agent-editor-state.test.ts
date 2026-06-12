import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDefinitionFromForm,
  buildToolsPolicyFromSelection,
  formSnapshotJson,
  isPromptBlockPersistent,
  stripRemovedPromptBlocks,
  toolsSelectionFromDefinition,
  withPromptBlockPersistence,
  withPromptBlockRole,
} from "../../src/config-forms/agent/agent-editor-state.js";

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

test("withPromptBlockPersistence maps UI switch to lifecycle", () => {
  const block = { name: "k", type: "text" as const, role: "user" as const, content: "go" };
  assert.equal(isPromptBlockPersistent(block), true);
  const once = withPromptBlockPersistence(block, false);
  assert.equal(once.lifecycle, "once");
  assert.equal(isPromptBlockPersistent(once), false);
  const again = withPromptBlockPersistence(once, true);
  assert.equal(again.lifecycle, undefined);
});

test("withPromptBlockPersistence restore requires full block replace in UI", () => {
  const once = {
    name: "k",
    type: "text" as const,
    role: "user" as const,
    content: "x",
    lifecycle: "once" as const,
  };
  const restored = withPromptBlockPersistence(once, true);
  assert.equal("lifecycle" in restored, false);
  // Partial merge ({ ...once, ...restored }) would incorrectly keep lifecycle: once.
  const badMerge = { ...once, ...restored };
  assert.equal(badMerge.lifecycle, "once");
});

test("withPromptBlockRole strips lifecycle for system role", () => {
  const block = {
    name: "k",
    type: "text" as const,
    role: "user" as const,
    content: "go",
    lifecycle: "once" as const,
  };
  const system = withPromptBlockRole(block, "system");
  assert.equal(system.role, "system");
  assert.equal(system.lifecycle, undefined);
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
