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
  movePersistBlock,
  PROMPT_REGION_LABELS,
  splitPersistBlocksForEditor,
  toolsSelectionFromDefinition,
  updatePersistWorktreeRole,
  withDynamicBlockPersistence,
  WORKTREE_BLOCK_WIRE_NAME,
} from "../../src/config-forms/agent/agent-editor-state.js";
import { validateAgentPromptLayout } from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";

test("PROMPT_REGION_LABELS 三区主文案为中文且无 wire 英文主标签", () => {
  assert.equal(PROMPT_REGION_LABELS.layoutTitle, "提示词模版");
  assert.equal(PROMPT_REGION_LABELS.apiSystemField, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.systemPromptTitle, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.maxStepsLabel, "最大步数");
  assert.equal(PROMPT_REGION_LABELS.emptyPersistHint, "暂无块，点击添加");
  assert.equal(PROMPT_REGION_LABELS.emptyDynamicHint, "暂无块，点击添加");
  assert.equal(PROMPT_REGION_LABELS.systemDisabledHint, "关闭时不写入系统提示词。");
  assert.equal(PROMPT_REGION_LABELS.persistRegionHint, "持久区禁止宏与生命周期。");
  assert.equal(PROMPT_REGION_LABELS.dynamicLifecycleOnceHint, "仅首轮请求带入。");

  const values = Object.values(PROMPT_REGION_LABELS).filter(
    (value): value is string => typeof value === "string",
  );
  for (const value of values) {
    assert.doesNotMatch(value, /API system/i);
    assert.doesNotMatch(value, /Prompt 布局/i);
    assert.doesNotMatch(value, /prompts\.system/i);
    assert.doesNotMatch(value, /LLM system/i);
    assert.doesNotMatch(value, /lifecycle/i);
    assert.doesNotMatch(value, /agent step/i);
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

test("createDefaultWorktreeBlock uses stable name and default role", () => {
  assert.deepEqual(createDefaultWorktreeBlock(), {
    name: WORKTREE_BLOCK_WIRE_NAME,
    type: "worktree",
    role: "user",
  });
});

test("splitPersistBlocksForEditor normalizes worktree wire name and role", () => {
  const split = splitPersistBlocksForEditor([
    { name: "persona", type: "text", role: "user", content: "x" },
    { name: "custom", type: "worktree" },
  ]);
  assert.equal(split.textBlocks.length, 1);
  assert.deepEqual(split.worktree, {
    name: WORKTREE_BLOCK_WIRE_NAME,
    type: "worktree",
    role: "user",
  });
  assert.deepEqual(split.blocks, [
    { name: "persona", type: "text", role: "user", content: "x" },
    { name: WORKTREE_BLOCK_WIRE_NAME, type: "worktree", role: "user" },
  ]);
});

test("layoutFromFormInput preserves mixed persist order", () => {
  const layout = layoutFromFormInput({
    systemEnabled: false,
    systemContent: "",
    persist: [
      { name: "custom", type: "worktree", role: "assistant" },
      { name: "persona", type: "text", role: "user", content: "x" },
    ],
    dynamic: [],
  });
  assert.deepEqual(layout.persist, [
    { name: WORKTREE_BLOCK_WIRE_NAME, type: "worktree", role: "assistant" },
    { name: "persona", type: "text", role: "user", content: "x" },
  ]);
});

test("movePersistBlock reorders worktree-only persist", () => {
  const only = [createDefaultWorktreeBlock()];
  assert.deepEqual(movePersistBlock(only, 0, -1), only);
  assert.deepEqual(movePersistBlock(only, 0, 1), only);
});

test("movePersistBlock swaps text and worktree in mixed persist", () => {
  const mixed = [
    { name: "p1", type: "text" as const, role: "user" as const, content: "a" },
    createDefaultWorktreeBlock(),
    { name: "p2", type: "text" as const, role: "assistant" as const, content: "b" },
  ];
  const movedUp = movePersistBlock(mixed, 1, -1);
  assert.deepEqual(
    movedUp.map((block) => block.type),
    ["worktree", "text", "text"],
  );
  const movedDown = movePersistBlock(mixed, 0, 1);
  assert.deepEqual(
    movedDown.map((block) => block.type),
    ["worktree", "text", "text"],
  );
});

test("updatePersistWorktreeRole updates worktree role only", () => {
  const persist = [
    { name: "p1", type: "text" as const, role: "user" as const, content: "a" },
    createDefaultWorktreeBlock(),
  ];
  const updated = updatePersistWorktreeRole(persist, "assistant");
  assert.equal(updated[0]?.type, "text");
  assert.equal(updated[0]?.type === "text" ? updated[0].role : undefined, "user");
  assert.deepEqual(updated[1], {
    name: WORKTREE_BLOCK_WIRE_NAME,
    type: "worktree",
    role: "assistant",
  });
});

test("buildAgentDefinitionFromForm wire order matches mixed persist editor order", () => {
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
      createDefaultWorktreeBlock(),
      { name: "p1", type: "text", role: "user", content: "after tree" },
    ],
    dynamic: [],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.definition.prompts.persist.map((block) => block.type),
      ["worktree", "text"],
    );
    const validated = validateAgentPromptLayout(result.definition.prompts);
    assert.equal(validated.persist[0]?.type, "worktree");
    assert.equal(
      validated.persist[0]?.type === "worktree" ? validated.persist[0].role : undefined,
      "user",
    );
  }
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
