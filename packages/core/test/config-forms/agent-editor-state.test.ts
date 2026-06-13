import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDefinitionFromForm,
  buildToolsPolicyFromSelection,
  countFormPromptSources,
  countMinimumPromptSources,
  createDefaultAgentEditorPrompts,
  createDefaultWorktreeBlock,
  definitionToForm,
  formSnapshotJson,
  isDynamicBlockPersistent,
  layoutFromFormInput,
  PROMPT_REGION_LABELS,
  splitPersistBlocksForEditor,
  toolsSelectionFromDefinition,
  withDynamicBlockPersistence,
  WORKTREE_BLOCK_WIRE_NAME,
} from "../../src/config-forms/agent/agent-editor-state.js";

test("PROMPT_REGION_LABELS 三区主文案为中文且无 wire 英文主标签", () => {
  assert.equal(PROMPT_REGION_LABELS.layoutTitle, "提示词模版");
  assert.equal(PROMPT_REGION_LABELS.apiSystemField, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.systemPromptTitle, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.maxStepsLabel, "最大步数");
  assert.equal(PROMPT_REGION_LABELS.emptyPersistHint, "暂无块，点击添加");
  assert.equal(PROMPT_REGION_LABELS.emptyDynamicHint, "暂无块，点击添加");
  assert.equal(PROMPT_REGION_LABELS.systemDisabledHint, "关闭时不写入系统提示词。");

  const values = Object.values(PROMPT_REGION_LABELS).filter(
    (value): value is string => typeof value === "string",
  );
  for (const value of values) {
    assert.doesNotMatch(value, /API system/i);
    assert.doesNotMatch(value, /Prompt 布局/i);
    assert.doesNotMatch(value, /prompts\.system/i);
    assert.doesNotMatch(value, /LLM system/i);
  }
});

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
  assert.deepEqual(createDefaultWorktreeBlock(), {
    name: WORKTREE_BLOCK_WIRE_NAME,
    type: "worktree",
  });
});

test("splitPersistBlocksForEditor normalizes worktree wire name", () => {
  const split = splitPersistBlocksForEditor([
    { name: "persona", type: "text", role: "user", content: "x" },
    { name: "custom", type: "worktree" },
  ]);
  assert.equal(split.textBlocks.length, 1);
  assert.deepEqual(split.worktree, { name: WORKTREE_BLOCK_WIRE_NAME, type: "worktree" });
});

test("layoutFromFormInput places worktree after text blocks with fixed name", () => {
  const layout = layoutFromFormInput({
    systemEnabled: false,
    systemContent: "",
    persist: [
      { name: "custom", type: "worktree" },
      { name: "persona", type: "text", role: "user", content: "x" },
    ],
    dynamic: [],
  });
  assert.deepEqual(layout.persist, [
    { name: "persona", type: "text", role: "user", content: "x" },
    { name: WORKTREE_BLOCK_WIRE_NAME, type: "worktree" },
  ]);
});

test("createDefaultAgentEditorPrompts starts with empty persist", () => {
  const defaults = createDefaultAgentEditorPrompts();
  assert.equal(defaults.systemEnabled, false);
  assert.equal(defaults.persist.length, 0);
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
    }).ok,
    false,
  );
  assert.equal(
    buildAgentDefinitionFromForm({
      name: "writer",
      maxSteps: "20",
      modelEnabled: false,
      providerId: "",
      vendorModelId: "",
      toolsMode: "default",
      toolsSelected: [],
      ...createDefaultAgentEditorPrompts(),
    }).ok,
    false,
  );
});

test("buildAgentDefinitionFromForm allows empty persist with system content", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    vendorModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: true,
    systemContent: "你是写作助手",
    persist: [],
    dynamic: [],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.prompts.system, "你是写作助手");
    assert.deepEqual(result.definition.prompts.persist, []);
  }
});

test("buildAgentDefinitionFromForm allows empty persist with dynamic block", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    vendorModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persist: [],
    dynamic: [{ name: "state", type: "text", role: "user", content: "{{$time}}" }],
  });
  assert.equal(result.ok, true);
});

test("buildAgentDefinitionFromForm allows worktree-only persist", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    vendorModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persist: [createDefaultWorktreeBlock()],
    dynamic: [],
  });
  assert.equal(result.ok, true);
});

test("countMinimumPromptSources 仅统计 system 与 dynamic", () => {
  assert.equal(
    countMinimumPromptSources({
      systemEnabled: true,
      systemContent: "sys",
      dynamic: [{ name: "d1", type: "text", role: "user", content: "x" }],
    }),
    2,
  );
  assert.equal(
    countMinimumPromptSources({
      systemEnabled: true,
      systemContent: "   ",
      dynamic: [],
    }),
    0,
  );
  assert.equal(
    countMinimumPromptSources(
      {
        systemEnabled: false,
        systemContent: "",
        dynamic: [
          { name: "d1", type: "text", role: "user", content: "a" },
          { name: "d2", type: "text", role: "user", content: "b" },
        ],
      },
      { excludeDynamicIndex: 0 },
    ),
    1,
  );
});

test("countFormPromptSources ignores enabled system without content", () => {
  assert.equal(
    countFormPromptSources({
      systemEnabled: true,
      systemContent: "   ",
      persist: [],
      dynamic: [{ name: "d1", type: "text", role: "user", content: "x" }],
    }),
    1,
  );
  assert.equal(
    countFormPromptSources(
      {
        systemEnabled: true,
        systemContent: "sys",
        persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
        dynamic: [],
      },
      { excludePersistTextIndex: 0 },
    ),
    1,
  );
});

test("countFormPromptSources counts all regions and respects exclusions", () => {
  const input = {
    systemEnabled: true,
    systemContent: "sys",
    persist: [
      { name: "p1", type: "text", role: "user", content: "a" },
      { name: WORKTREE_BLOCK_WIRE_NAME, type: "worktree" as const },
    ],
    dynamic: [
      { name: "d1", type: "text" as const, role: "user" as const, content: "b" },
      { name: "d2", type: "text" as const, role: "user" as const, content: "c" },
    ],
  };
  assert.equal(countFormPromptSources(input), 5);
  assert.equal(countFormPromptSources(input, { excludeDynamicIndex: 1 }), 4);
  assert.equal(countFormPromptSources(input, { excludeWorktree: true }), 4);
  assert.equal(
    countFormPromptSources(input, {
      excludePersistTextIndex: 0,
      excludeDynamicIndex: 0,
      excludeWorktree: true,
    }),
    2,
  );
});

test("buildAgentDefinitionFromForm rejects persist macros", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    vendorModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persist: [
      {
        name: "bad",
        type: "text",
        role: "user",
        content: "时间 {{$time}}",
      },
    ],
    dynamic: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /persist|macro|宏/i);
  }
});

test("buildAgentDefinitionFromForm rejects dynamic legacy dot macros", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    vendorModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persist: [{ name: "p1", type: "text", role: "user", content: "ok" }],
    dynamic: [
      {
        name: "d1",
        type: "text",
        role: "user",
        content: "{{.filetree}}",
      },
    ],
  });
  assert.equal(result.ok, false);
});
