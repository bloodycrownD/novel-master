import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentDefinitionFromForm,
  buildToolsPolicyFromSelection,
  countEffectiveFormPromptSources,
  countFormPromptSources,
  countMinimumPromptSources,
  createDefaultAgentEditorPrompts,
  definitionToForm,
  formSnapshotJson,
  isDynamicBlockPersistent,
  layoutFromFormInput,
  movePersistBlock,
  PROMPT_REGION_LABELS,
  splitPersistBlocksForEditor,
  toolsSelectionFromDefinition,
  withDynamicBlockPersistence,
  WORKPLACE_BLOCK_HINT,
  DEFAULT_WORKPLACE_ASSISTANT_TEXT,
} from "../../src/config-forms/agent/agent-editor-state.js";
import { validateAgentPromptLayout } from "../../src/domain/prompt/logic/validate-agent-prompt-layout.js";

test("PROMPT_REGION_LABELS 三区主文案为中文且无 wire 英文主标签", () => {
  assert.equal(PROMPT_REGION_LABELS.layoutTitle, "提示词模版");
  assert.equal(PROMPT_REGION_LABELS.apiSystemField, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.systemPromptTitle, "系统提示词");
  assert.equal(PROMPT_REGION_LABELS.maxStepsLabel, "最大步数");
  assert.equal(
    PROMPT_REGION_LABELS.maxStepsHint,
    "限制单轮任务中模型与工具的往返次数；未填写时默认为 20。"
  );
  assert.equal(PROMPT_REGION_LABELS.emptyPersistHint, "暂无块，点击添加");
  assert.equal(PROMPT_REGION_LABELS.emptyDynamicHint, "暂无块，点击添加");
  assert.equal(
    PROMPT_REGION_LABELS.systemDisabledHint,
    "关闭时不写入系统提示词。"
  );
  assert.equal(
    PROMPT_REGION_LABELS.persistDisabledHint,
    "关闭后持久区内容不会发送给 AI，已填写的内容仍保留。"
  );
  assert.equal(
    PROMPT_REGION_LABELS.dynamicDisabledHint,
    "关闭后动态区内容不会发送给 AI，已填写的内容仍保留。"
  );
  assert.equal(PROMPT_REGION_LABELS.chatTag, "会话消息");
  assert.equal(
    PROMPT_REGION_LABELS.layoutOrder,
    "系统 → 常驻工作区 → 持久区 → 会话历史 → 动态区"
  );
  assert.equal(
    PROMPT_REGION_LABELS.persistRegionHint,
    "持久区禁止宏与生命周期。"
  );
  assert.equal(
    PROMPT_REGION_LABELS.dynamicLifecycleOnceHint,
    "仅首轮请求带入。"
  );

  const values = Object.values(PROMPT_REGION_LABELS).filter(
    (value): value is string => typeof value === "string"
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

test("WORKPLACE_BLOCK_HINT 新文案", () => {
  assert.equal(
    WORKPLACE_BLOCK_HINT,
    "开启后每轮在会话前注入：用户侧项目文件树 + 助手侧 done 确认（【done】）。"
  );
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
    { mode: "allow", selected: ["read"] }
  );
  assert.deepEqual(
    toolsSelectionFromDefinition({
      name: "a",
      prompts: { persist: [], dynamic: [] },
    }),
    {
      mode: "default",
      selected: [],
    }
  );
});

test("definitionToForm maps system toggle and three regions", () => {
  const form = definitionToForm({
    name: "writer",
    prompts: {
      system: "sys",
      persistEnabled: true,
      dynamicEnabled: true,
      workplace: "【done】",
      persist: [],
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
  assert.equal(form.workplace, true);
  assert.equal(form.persist.length, 0);
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
  assert.equal(form.workplace, false);
});

test("layoutFromFormInput omits system when switch off", () => {
  const layout = layoutFromFormInput({
    systemEnabled: false,
    systemContent: "ignored",
    persistEnabled: false,
    dynamicEnabled: false,
    workplace: false,
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
    workplace: false,
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
  const block = {
    name: "k",
    type: "text" as const,
    role: "user" as const,
    content: "go",
  };
  assert.equal(isDynamicBlockPersistent(block), true);
  const once = withDynamicBlockPersistence(block, false);
  assert.equal(once.lifecycle, "once");
  assert.equal(isDynamicBlockPersistent(once), false);
  const again = withDynamicBlockPersistence(once, true);
  assert.equal(again.lifecycle, undefined);
});

test("splitPersistBlocksForEditor strips legacy worktree blocks", () => {
  const split = splitPersistBlocksForEditor([
    { name: "persona", type: "text", role: "user", content: "x" },
    { name: "custom", type: "worktree" },
  ]);
  assert.equal(split.textBlocks.length, 1);
  assert.deepEqual(split.blocks, [
    { name: "persona", type: "text", role: "user", content: "x" },
  ]);
});

test("layoutFromFormInput maps workplace boolean and strips legacy worktree", () => {
  const layout = layoutFromFormInput({
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
    workplace: true,
    persist: [
      { name: "custom", type: "worktree", role: "assistant" },
      { name: "persona", type: "text", role: "user", content: "x" },
    ],
    dynamic: [],
  });
  assert.equal(layout.workplace, DEFAULT_WORKPLACE_ASSISTANT_TEXT);
  assert.deepEqual(layout.persist, [
    { name: "persona", type: "text", role: "user", content: "x" },
  ]);
});

test("movePersistBlock swaps text blocks", () => {
  const blocks = [
    { name: "p1", type: "text" as const, role: "user" as const, content: "a" },
    {
      name: "p2",
      type: "text" as const,
      role: "assistant" as const,
      content: "b",
    },
  ];
  const movedDown = movePersistBlock(blocks, 0, 1);
  assert.deepEqual(
    movedDown.map((block) => block.name),
    ["p2", "p1"]
  );
});

test("buildAgentDefinitionFromForm maps workplace boolean", () => {
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
    workplace: true,
    persist: [
      { name: "p1", type: "text", role: "user", content: "after tree" },
    ],
    dynamic: [],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.definition.prompts.workplace,
      DEFAULT_WORKPLACE_ASSISTANT_TEXT,
    );
    assert.deepEqual(
      result.definition.prompts.persist.map((block) => block.type),
      ["text"]
    );
    assert.equal(result.definition.prompts.persist[0]?.name, "p1");
  }
});

test("T-W7: definitionToForm ↔ layoutFromFormInput round-trip workplace", () => {
  const formOn = definitionToForm({
    name: "writer",
    prompts: {
      workplace: "【done】",
      persist: [],
      dynamic: [],
    },
  });
  assert.equal(formOn.workplace, true);
  assert.equal(
    layoutFromFormInput(formOn).workplace,
    DEFAULT_WORKPLACE_ASSISTANT_TEXT,
  );

  const formOff = { ...formOn, workplace: false };
  assert.equal(layoutFromFormInput(formOff).workplace, undefined);

  const roundTrip = definitionToForm({
    name: "writer",
    prompts: layoutFromFormInput(formOn),
  });
  assert.equal(roundTrip.workplace, true);
});

test("createDefaultAgentEditorPrompts persist 无 worktree", () => {
  const defaults = createDefaultAgentEditorPrompts();
  assert.equal(defaults.persist.length, 0);
  assert.equal(defaults.workplace, false);
  assert.ok(defaults.persist.every((block) => block.type !== "worktree"));
});

test("definitionToForm workplace 非空 string 可 derive Switch 开", () => {
  const form = definitionToForm({
    name: "writer",
    prompts: {
      workplace: "【done】",
      persist: [],
      dynamic: [],
    },
  });
  assert.equal(form.workplace, true);
  assert.equal(form.persist.length, 0);
});

test("createDefaultAgentEditorPrompts starts with empty persist", () => {
  const defaults = createDefaultAgentEditorPrompts();
  assert.equal(defaults.systemEnabled, false);
  assert.equal(defaults.persistEnabled, false);
  assert.equal(defaults.dynamicEnabled, false);
  assert.equal(defaults.persist.length, 0);
  assert.equal(defaults.dynamic.length, 0);
});

test("formSnapshotJson includes persistEnabled/dynamicEnabled and workplace", () => {
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
    workplace: true,
  });
  const parsed = JSON.parse(json) as Record<string, unknown>;
  assert.equal(parsed.persistEnabled, true);
  assert.equal(parsed.dynamicEnabled, false);
  assert.equal(parsed.workplace, true);
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
    false
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
    true
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
    workplace: false,
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
      workplace: false,
      persist: [],
      dynamic: [],
    }),
    0
  );
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: true,
      systemContent: "sys",
      persistEnabled: true,
      dynamicEnabled: true,
      workplace: false,
      persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
      dynamic: [{ name: "d1", type: "text", role: "user", content: "y" }],
    }),
    3
  );
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: true,
      systemContent: "   ",
      persistEnabled: true,
      dynamicEnabled: false,
      workplace: false,
      persist: [],
      dynamic: [{ name: "d1", type: "text", role: "user", content: "y" }],
    }),
    0
  );
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: false,
      systemContent: "ignored",
      persistEnabled: true,
      dynamicEnabled: false,
      workplace: false,
      persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
      dynamic: [],
    }),
    1
  );
  assert.equal(
    countEffectiveFormPromptSources({
      systemEnabled: false,
      systemContent: "",
      persistEnabled: false,
      dynamicEnabled: false,
      workplace: true,
      persist: [],
      dynamic: [],
    }),
    1
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
    workplace: false,
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
    workplace: false,
    persist: [],
    dynamic: [
      { name: "state", type: "text", role: "user", content: "{{$time}}" },
    ],
  });
  assert.equal(result.ok, true);
});

test("T-W8: buildAgentDefinitionFromForm workplace:true 且区域开关全关可保存", () => {
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
    workplace: true,
    persist: [],
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
    2
  );
  assert.equal(
    countMinimumPromptSources({
      systemEnabled: true,
      systemContent: "   ",
      dynamic: [],
    }),
    0
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
      { excludeDynamicIndex: 0 }
    ),
    1
  );
});

test("countFormPromptSources ignores enabled system without content", () => {
  assert.equal(
    countFormPromptSources({
      systemEnabled: true,
      systemContent: "   ",
      workplace: false,
      persist: [],
      dynamic: [{ name: "d1", type: "text", role: "user", content: "x" }],
    }),
    1
  );
  assert.equal(
    countFormPromptSources(
      {
        systemEnabled: true,
        systemContent: "sys",
        workplace: false,
        persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
        dynamic: [],
      },
      { excludePersistTextIndex: 0 }
    ),
    1
  );
});

test("countFormPromptSources counts all regions and respects exclusions", () => {
  const input = {
    systemEnabled: true,
    systemContent: "sys",
    workplace: true,
    persist: [{ name: "p1", type: "text", role: "user", content: "a" }],
    dynamic: [
      {
        name: "d1",
        type: "text" as const,
        role: "user" as const,
        content: "b",
      },
      {
        name: "d2",
        type: "text" as const,
        role: "user" as const,
        content: "c",
      },
    ],
  };
  assert.equal(countFormPromptSources(input), 5);
  assert.equal(countFormPromptSources(input, { excludeDynamicIndex: 1 }), 4);
  assert.equal(countFormPromptSources({ ...input, workplace: false }), 4);
  assert.equal(
    countFormPromptSources(input, {
      excludePersistTextIndex: 0,
      excludeDynamicIndex: 0,
    }),
    3
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
    workplace: false,
    persist: [
      {
        name: "p1",
        type: "text" as const,
        role: "assistant" as const,
        content: "我将遵守",
      },
    ],
    dynamic: [
      {
        name: "d1",
        type: "text" as const,
        role: "assistant" as const,
        content: "a",
      },
      {
        name: "d2",
        type: "text" as const,
        role: "user" as const,
        content: "b",
      },
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
    workplace: false,
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
    workplace: false,
    persist: [{ name: "p1", type: "text", role: "user", content: "x" }],
    dynamic: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /助手/);
  }
});

test("buildAgentDefinitionFromForm persistEnabled 开且 workplace + 文本末块 assistant 可保存", () => {
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
    workplace: true,
    persist: [
      { name: "p1", type: "text", role: "user", content: "x" },
      { name: "tail", type: "text", role: "assistant", content: "ok" },
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
    workplace: false,
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
    workplace: false,
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
    workplace: false,
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
    workplace: false,
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

test("layoutFromFormInput output passes validateAgentPromptLayout", () => {
  const layout = layoutFromFormInput({
    systemEnabled: true,
    systemContent: "sys",
    persistEnabled: true,
    dynamicEnabled: true,
    workplace: true,
    persist: [{ name: "p1", type: "text", role: "assistant", content: "ok" }],
    dynamic: [
      { name: "d1", type: "text", role: "assistant", content: "a" },
      { name: "d2", type: "text", role: "user", content: "b" },
    ],
  });
  assert.doesNotThrow(() => validateAgentPromptLayout(layout));
});
