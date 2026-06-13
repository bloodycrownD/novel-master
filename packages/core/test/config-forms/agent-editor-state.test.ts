import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDefinitionFromForm,
  buildToolsPolicyFromSelection,
  createDefaultAgentEditorPrompts,
  createDefaultWorktreeBlock,
  definitionToForm,
  formSnapshotJson,
  isDynamicBlockPersistent,
  layoutFromFormInput,
  toolsSelectionFromDefinition,
  withDynamicBlockPersistence,
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
    toolsSelectionFromDefinition({
      name: "a",
      prompts: { persist: [], dynamic: [] },
      tools: { allow: ["read"] },
    }),
    { mode: "allow", selected: ["read"] },
  );
  assert.deepEqual(
    toolsSelectionFromDefinition({ name: "a", prompts: { persist: [], dynamic: [] } }),
    {
      mode: "default",
      selected: [],
    },
  );
});

test("definitionToForm maps system toggle and three regions", () => {
  const form = definitionToForm({
    name: "writer",
    prompts: {
      system: "sys",
      persist: [{ name: "canon", type: "worktree" }],
      dynamic: [
        {
          name: "state",
          type: "text",
          role: "user",
          content: "{{$time}}",
          lifecycle: "once",
        },
      ],
    },
  });
  assert.equal(form.systemEnabled, true);
  assert.equal(form.systemContent, "sys");
  assert.equal(form.persist.length, 1);
  assert.equal(form.dynamic[0]?.lifecycle, "once");
});

test("layoutFromFormInput omits system when switch off", () => {
  const layout = layoutFromFormInput({
    systemEnabled: false,
    systemContent: "ignored",
    persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
    dynamic: [],
  });
  assert.equal(layout.system, undefined);
});

test("withDynamicBlockPersistence maps UI switch to lifecycle", () => {
  const block = { name: "k", type: "text" as const, role: "user" as const, content: "go" };
  assert.equal(isDynamicBlockPersistent(block), true);
  const once = withDynamicBlockPersistence(block, false);
  assert.equal(once.lifecycle, "once");
  assert.equal(isDynamicBlockPersistent(once), false);
  const again = withDynamicBlockPersistence(once, true);
  assert.equal(again.lifecycle, undefined);
});

test("createDefaultWorktreeBlock uses stable name", () => {
  assert.deepEqual(createDefaultWorktreeBlock(), { name: "canon", type: "worktree" });
});

test("createDefaultAgentEditorPrompts includes one persist text block", () => {
  const defaults = createDefaultAgentEditorPrompts();
  assert.equal(defaults.systemEnabled, false);
  assert.equal(defaults.persist.length, 1);
  assert.equal(defaults.dynamic.length, 0);
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
    ...createDefaultAgentEditorPrompts(),
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
      ...createDefaultAgentEditorPrompts(),
      persist: [],
    }).ok,
    false,
  );
});
