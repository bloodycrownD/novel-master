import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDefinitionFromForm,
  buildToolsPolicyFromSelection,
  countEffectiveFormPromptSources,
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
  WORKTREE_BLOCK_HINT,
} from "../../src/config-forms/agent/agent-editor-state.js";
import { validateAgentPromptLayout } from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";

test("PROMPT_REGION_LABELS 三区主文案为中文且无 wire 英文主标签", () => {
  assert.equal(PROMPT_REGION_LABELS.layoutTitle, "提示词模版");
  assert.equal(PROMPT_REGION_LABELS.apiSystemField, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.systemPromptTitle, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.maxStepsLabel, "最大步数");
  assert.equal(
    PROMPT_REGION_LABELS.maxStepsHint,
    "限制单轮任务中模型与工具的往返次数；未填写时默认为 20。",
  );
  assert.equal(PROMPT_REGION_LABELS.emptyPersistHint, "暂无块，点击添加");
  assert.equal(PROMPT_REGION_LABELS.emptyDynamicHint, "暂无块，点击添加");
  assert.equal(PROMPT_REGION_LABELS.systemDisabledHint, "关闭时不写入系统提示词。");
  assert.equal(
    PROMPT_REGION_LABELS.persistDisabledHint,
    "关闭后持久区内容不会发送给 AI，已填写的内容仍保留。",
  );
  assert.equal(
    PROMPT_REGION_LABELS.dynamicDisabledHint,
    "关闭后动态区内容不会发送给 AI，已填写的内容仍保留。",
  );
  assert.equal(PROMPT_REGION_LABELS.chatTag, "会话消息");
  assert.equal(
    WORKTREE_BLOCK_HINT,
    "运行时自动注入当前会话的项目文件树，供模型了解可访问的文件。角色决定注入消息在模型侧显示为用户或助手；启用持久区时若工作树作为末块，请设为助手。",
  );
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
    assert.doesNotMatch(value, /\bwire\b/i);
    assert.doesNotMatch(value, /materialize/i);
    assert.doesNotMatch(value, /\bCore\b/);
    assert.doesNotMatch(value, /\brun\b/i);
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
      persistEnabled: true,
      dynamicEnabled: true,
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
  assert.equal(form.persistEnabled, true);
  assert.equal(form.dynamicEnabled, true);
  assert.equal(form.persist.length, 1);
  assert.equal(form.dynamic[0]?.lifecycle, "once");
});

test("definitionToForm 缺省 persistEnabled/dynamicEnabled 为 false", () => {
  const form = definitionToForm({
    name: "writer",
    prompts: {
      persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
      dynamic: [],
    },
  });
  assert.equal(form.persistEnabled, false);
  assert.equal(form.dynamicEnabled, false);
});

test("layoutFromFormInput omits system when switch off", () => {
  const layout = layoutFromFormInput({
    systemEnabled: false,
    systemContent: "ignored",
    persistEnabled: false,
    dynamicEnabled: false,
    persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
    dynamic: [],
  });
  assert.equal(layout.system, undefined);
  assert.equal(layout.persistEnabled, undefined);
  assert.equal(layout.dynamicEnabled, undefined);
});

test("layoutFromFormInput wires persistEnabled/dynamicEnabled when on", () => {
  const layout = layoutFromFormInput({
    systemEnabled: false,
    systemContent: "",
    persistEnabled: true,
    dynamicEnabled: true,
    persist: [{ name: "p1", type: "text", role: "assistant", content: "ok" }],
    dynamic: [
      { name: "d1", type: "text", role: "assistant", content: "a" },
      { name: "d2", type: "text", role: "user", content: "b" },
    ],
  });
  assert.equal(layout.persistEnabled, true);
  assert.equal(layout.dynamicEnabled, true);
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
    persistEnabled: false,
    dynamicEnabled: false,
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
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
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
  assert.equal(defaults.persistEnabled, false);
  assert.equal(defaults.dynamicEnabled, false);
  assert.equal(defaults.persist.length, 0);
  assert.equal(defaults.dynamic.length, 0);
});

test("formSnapshotJson includes persistEnabled/dynamicEnabled", () => {
  const json = formSnapshotJson({
    name: "agent",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "p",
    savedModelId: "m",
    toolsMode: "default",
    toolsSelected: [],
    ...createDefaultAgentEditorPrompts(),
    persistEnabled: true,
    dynamicEnabled: false,
  });
  const parsed = JSON.parse(json) as Record<string, unknown>;
  assert.equal(parsed.persistEnabled, true);
  assert.equal(parsed.dynamicEnabled, false);
});

test("formSnapshotJson omits model fields when disabled", () => {
  const json = formSnapshotJson({
    name: "agent",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "p",
    savedModelId: "m",
    toolsMode: "default",
    toolsSelected: [],
    ...createDefaultAgentEditorPrompts(),
  });
  const parsed = JSON.parse(json) as Record<string, unknown>;
  assert.equal(parsed.providerId, undefined);
  assert.equal(parsed.savedModelId, undefined);
});

test("buildAgentDefinitionFromForm validates required fields", () => {
  assert.equal(
    buildAgentDefinitionFromForm({
      name: "",
      maxSteps: "20",
      modelEnabled: false,
      providerId: "",
      savedModelId: "",
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
      savedModelId: "",
      toolsMode: "default",
      toolsSelected: [],
      ...createDefaultAgentEditorPrompts(),
    }).ok,
    true,
  );
});

test("buildAgentDefinitionFromForm 三区全关空 layout 可保存", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    ...createDefaultAgentEditorPrompts(),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.prompts.system, undefined);
    assert.deepEqual(result.definition.prompts.persist, []);
    assert.deepEqual(result.definition.prompts.dynamic, []);
  }
});

test("buildAgentDefinitionFromForm system 开但内容空时失败", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: true,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
    persist: [],
    dynamic: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, "至少保留一个 Prompt 块");
  }
});

test("countEffectiveFormPromptSources 按区域开关统计有效来源", () => {
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: false,
      systemContent: "",
      persistEnabled: false,
      dynamicEnabled: false,
      persist: [],
      dynamic: [],
    }),
    0,
  );
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: true,
      systemContent: "sys",
      persistEnabled: true,
      dynamicEnabled: true,
      persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
      dynamic: [{ name: "d1", type: "text", role: "user", content: "y" }],
    }),
    3,
  );
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: true,
      systemContent: "   ",
      persistEnabled: true,
      dynamicEnabled: false,
      persist: [],
      dynamic: [{ name: "d1", type: "text", role: "user", content: "y" }],
    }),
    0,
  );
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: false,
      systemContent: "ignored",
      persistEnabled: true,
      dynamicEnabled: false,
      persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
      dynamic: [],
    }),
    1,
  );
});

test("buildAgentDefinitionFromForm allows empty persist with system content", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: true,
    systemContent: "你是写作助手",
    persistEnabled: false,
    dynamicEnabled: false,
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
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
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
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
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

test("buildAgentDefinitionFromForm round-trips persistEnabled/dynamicEnabled", () => {
  const input = {
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default" as const,
    toolsSelected: [] as string[],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: true,
    dynamicEnabled: true,
    persist: [
      { name: "p1", type: "text" as const, role: "assistant" as const, content: "我将遵守" },
    ],
    dynamic: [
      { name: "d1", type: "text" as const, role: "assistant" as const, content: "a" },
      { name: "d2", type: "text" as const, role: "user" as const, content: "b" },
    ],
  };
  const result = buildAgentDefinitionFromForm(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.prompts.persistEnabled, true);
    assert.equal(result.definition.prompts.dynamicEnabled, true);
    const form = definitionToForm(result.definition);
    assert.equal(form.persistEnabled, true);
    assert.equal(form.dynamicEnabled, true);
  }
});

test("buildAgentDefinitionFromForm 开关关时省略 wire 布尔", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
    persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
    dynamic: [{ name: "d1", type: "text", role: "user", content: "y" }],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.prompts.persistEnabled, undefined);
    assert.equal(result.definition.prompts.dynamicEnabled, undefined);
  }
});

test("buildAgentDefinitionFromForm persistEnabled 开且末块不合规时失败", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: true,
    dynamicEnabled: false,
    persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
    dynamic: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /助手/);
  }
});

test("buildAgentDefinitionFromForm persistEnabled 开且 worktree assistant 末块可保存", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: true,
    dynamicEnabled: false,
    persist: [
      { name: "p1", type: "text", role: "user", content: "x" },
      { name: "canon", type: "worktree", role: "assistant" },
    ],
    dynamic: [],
  });
  assert.equal(result.ok, true);
});

test("buildAgentDefinitionFromForm dynamicEnabled 开且块数不足时失败", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: true,
    persist: [],
    dynamic: [{ name: "d1", type: "text", role: "user", content: "x" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /两个块/);
  }
});

test("buildAgentDefinitionFromForm 开关关时跳过启用后校验", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
    persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
    dynamic: [{ name: "d1", type: "text", role: "user", content: "y" }],
  });
  assert.equal(result.ok, true);
});

test("buildAgentDefinitionFromForm rejects persist macros", () => {
  const result = buildAgentDefinitionFromForm({
    name: "writer",
    maxSteps: "20",
    modelEnabled: false,
    providerId: "",
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
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
    savedModelId: "",
    toolsMode: "default",
    toolsSelected: [],
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
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
