import type {
  AgentDefinition,
  AgentToolPolicy,
} from "@/domain/agent/model/agent-definition.js";
import type {
  AgentPromptLayout,
  DynamicPromptBlock,
  EditorPersistPromptBlock,
  PersistTextPromptBlock,
} from "@/domain/prompt/model/agent-prompt-layout.js";
import {
  DEFAULT_WORKPLACE_ASSISTANT_TEXT,
  layoutHasWorkplace,
} from "@/domain/prompt/model/agent-prompt-layout.js";
import { validateAgentPromptLayout } from "@/domain/prompt/logic/validate-agent-prompt-layout.js";
import { PromptError } from "@/errors/prompt-errors.js";
import { isSavedModelUuidFormat } from "@/domain/provider/logic/assert-saved-model-uuid.js";
import {
  buildToolsPolicyFromSelection,
  toolsSelectionFromDefinition,
} from "./agent-tool-catalog.js";

export type ToolsMode = "default" | "allow" | "deny";

/** persist / dynamic 文本块可选角色（system 单独顶置）。 */
export const PROMPT_BLOCK_ROLES = ["user", "assistant"] as const;

export const TOOL_MODE_OPTIONS: Array<{ value: ToolsMode; label: string }> = [
  { value: "default", label: "默认（全部工具）" },
  { value: "allow", label: "白名单" },
  { value: "deny", label: "黑名单" },
];

const ROLE_LABELS: Record<(typeof PROMPT_BLOCK_ROLES)[number], string> = {
  user: "用户",
  assistant: "助手",
};

export const ROLE_OPTIONS = PROMPT_BLOCK_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

export { DEFAULT_WORKPLACE_ASSISTANT_TEXT };

/** Agent 编辑器表单（三区 layout，非扁平 prompts）。 */
export type AgentEditorFormInput = {
  name: string;
  maxSteps: string;
  modelEnabled: boolean;
  providerId: string;
  savedModelId: string;
  toolsMode: ToolsMode;
  toolsSelected: readonly string[];
  systemEnabled: boolean;
  systemContent: string;
  persistEnabled: boolean;
  dynamicEnabled: boolean;
  /** 常驻工作区开关（与域 `prompts.workplace` 对应）。 */
  workplace: boolean;
  persist: readonly EditorPersistPromptBlock[];
  dynamic: readonly DynamicPromptBlock[];
};

/** Parses comma/newline tool lists — retained for YAML import compatibility only. */
export function parseToolsList(text: string): string[] {
  return text
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** @deprecated Use {@link buildToolsPolicyFromSelection}. */
export function buildToolsPolicy(
  mode: ToolsMode,
  listText: string
): AgentToolPolicy | undefined {
  return buildToolsPolicyFromSelection(mode, parseToolsList(listText));
}

/** @deprecated Use {@link toolsSelectionFromDefinition}. */
export function toolsFromDefinition(def: AgentDefinition): {
  mode: ToolsMode;
  listText: string;
} {
  const { mode, selected } = toolsSelectionFromDefinition(def);
  return { mode, listText: selected.join(", ") };
}

export { buildToolsPolicyFromSelection, toolsSelectionFromDefinition };

/** 常驻工作区在编辑器中的类型标签（菜单与徽章；不展示 wire 槽位名）。 */
export const WORKPLACE_BLOCK_LABEL = "常驻工作区";

/** 常驻工作区说明（用户可见，避免技术术语）。 */
export const WORKPLACE_BLOCK_HINT =
  "开启后每轮在会话前注入：用户侧项目文件树 + 助手侧 done 确认（【done】）。";

/** Agent 编辑器三区 Prompt 用户可见文案（wire 字段名与类型名保持英文）。 */
export const PROMPT_REGION_LABELS = {
  layoutTitle: "提示词模版",
  system: "系统",
  systemBlocks: "系统区",
  systemContent: "系统内容",
  enableSystem: "启用系统",
  enablePersist: "启用持久区",
  enableDynamic: "启用动态区",
  apiSystemField: "系统提示词",
  systemPromptTitle: "系统提示词",
  persistBlocks: "持久区",
  dynamicBlocks: "动态区",
  persistRegionHint: "持久区禁止宏与生命周期。",
  layoutOrder: "系统 → 常驻工作区 → 持久区 → 会话历史 → 动态区",
  layoutOrderPrefix: "纵向顺序与模型组装一致：",
  layoutOrderPrefixShort: "纵向顺序：",
  systemDisabledHint: "关闭时不写入系统提示词。",
  persistDisabledHint: "关闭后持久区内容不会发送给 AI，已填写的内容仍保留。",
  dynamicDisabledHint: "关闭后动态区内容不会发送给 AI，已填写的内容仍保留。",
  systemPlaceholder: "单段系统级指令…",
  systemPlaceholderShort: "单段系统级指令…",
  maxStepsLabel: "最大步数",
  maxStepsHint: "限制单轮任务中模型与工具的往返次数；未填写时默认为 20。",
  emptyPersistHint: "暂无块，点击添加",
  emptyDynamicHint: "暂无块，点击添加",
  chat: "会话历史",
  chatTag: "会话消息",
  chatBlocks: "会话区",
  chatReadonlyHint:
    "运行时自动注入当前会话的可见消息，固定位于持久区与动态区之间。不可编辑、不可关闭，始终会发送给 AI。",
  dynamicLifecycleOnceHint: "仅首轮请求带入。",
} as const;

export function blockTypeLabel(
  _type: EditorPersistPromptBlock["type"] | DynamicPromptBlock["type"]
): string {
  return "文本";
}

function persistTextBlocksFromEditor(
  persist: readonly EditorPersistPromptBlock[]
): PersistTextPromptBlock[] {
  return persist.filter(
    (block): block is PersistTextPromptBlock => block.type === "text"
  );
}

/** 将 persist 拆为有序文本块列表（读入时丢弃旧 worktree 块）。 */
export function splitPersistBlocksForEditor(
  persist: readonly EditorPersistPromptBlock[]
): {
  readonly blocks: readonly PersistTextPromptBlock[];
  readonly textBlocks: readonly PersistTextPromptBlock[];
} {
  const textBlocks = persistTextBlocksFromEditor(persist);
  return { blocks: textBlocks, textBlocks };
}

/** 合并有序 persist 文本块（保留传入顺序）。 */
export function joinPersistBlocksForLayout(
  blocks: readonly EditorPersistPromptBlock[]
): PersistTextPromptBlock[] {
  return persistTextBlocksFromEditor(blocks);
}

export function mapPersistTextBlocks(
  persist: readonly EditorPersistPromptBlock[],
  mapper: (
    block: PersistTextPromptBlock,
    index: number
  ) => PersistTextPromptBlock
): PersistTextPromptBlock[] {
  const { textBlocks } = splitPersistBlocksForEditor(persist);
  return textBlocks.map(mapper);
}

export function movePersistBlock(
  persist: readonly EditorPersistPromptBlock[],
  index: number,
  direction: -1 | 1
): PersistTextPromptBlock[] {
  const blocks = [...splitPersistBlocksForEditor(persist).blocks];
  const target = index + direction;
  if (target < 0 || target >= blocks.length) {
    return persistTextBlocksFromEditor(persist);
  }
  const tmp = blocks[target]!;
  blocks[target] = blocks[index]!;
  blocks[index] = tmp;
  return blocks;
}

export function movePersistTextBlock(
  persist: readonly EditorPersistPromptBlock[],
  textIndex: number,
  direction: -1 | 1
): PersistTextPromptBlock[] {
  return movePersistBlock(persist, textIndex, direction);
}

export function deletePersistTextBlock(
  persist: readonly EditorPersistPromptBlock[],
  textIndex: number
): PersistTextPromptBlock[] {
  const { textBlocks } = splitPersistBlocksForEditor(persist);
  return textBlocks.filter((_, index) => index !== textIndex);
}

type DynamicTextBlock = DynamicPromptBlock;

/** dynamic 文本块是否在每轮 agent step 带入（lifecycle always）。 */
export function isDynamicBlockPersistent(block: DynamicTextBlock): boolean {
  return (block.lifecycle ?? "always") === "always";
}

/** 将 UI「常驻」开关映射为 lifecycle（常驻时省略字段）。 */
export function withDynamicBlockPersistence(
  block: DynamicTextBlock,
  persistent: boolean
): DynamicTextBlock {
  if (persistent) {
    const { lifecycle: _removed, ...rest } = block;
    return rest;
  }
  return { ...block, lifecycle: "once" };
}

/** 新建 Agent 默认 Prompt 表单片段。 */
export function createDefaultAgentEditorPrompts(): Pick<
  AgentEditorFormInput,
  | "systemEnabled"
  | "systemContent"
  | "persistEnabled"
  | "dynamicEnabled"
  | "workplace"
  | "persist"
  | "dynamic"
> {
  return {
    systemEnabled: false,
    systemContent: "",
    persistEnabled: false,
    dynamicEnabled: false,
    workplace: false,
    persist: [],
    dynamic: [],
  };
}

/** 是否启用了任一 Prompt 区域（system / persist / dynamic）。 */
export function hasAnyPromptRegionEnabled(
  input: Pick<
    AgentEditorFormInput,
    "systemEnabled" | "persistEnabled" | "dynamicEnabled"
  >
): boolean {
  return input.systemEnabled || input.persistEnabled || input.dynamicEnabled;
}

/** 是否存在与区域开关绑定的有效 Prompt 来源。 */
export function hasEffectivePromptSource(
  input: Pick<
    AgentEditorFormInput,
    | "systemEnabled"
    | "systemContent"
    | "persistEnabled"
    | "dynamicEnabled"
    | "workplace"
    | "persist"
    | "dynamic"
  >
): boolean {
  return countEffectiveFormPromptSources(input) > 0;
}

/** 统计与区域开关绑定的有效 Prompt 来源数量（每区至多计 1）。 */
export function countEffectiveFormPromptSources(
  input: Pick<
    AgentEditorFormInput,
    | "systemEnabled"
    | "systemContent"
    | "persistEnabled"
    | "dynamicEnabled"
    | "workplace"
    | "persist"
    | "dynamic"
  >
): number {
  let count = 0;
  if (input.systemEnabled && input.systemContent.trim() !== "") {
    count += 1;
  }
  if (input.persistEnabled && input.persist.length > 0) {
    count += 1;
  }
  if (input.dynamicEnabled && input.dynamic.length > 0) {
    count += 1;
  }
  if (input.workplace === true) {
    count += 1;
  }
  return count;
}

/** 统计 system + dynamic 有效 Prompt 来源（删除持久区块时允许 persist 全空）。 */
export function countMinimumPromptSources(
  input: Pick<
    AgentEditorFormInput,
    "systemEnabled" | "systemContent" | "dynamic"
  >,
  options?: { excludeDynamicIndex?: number }
): number {
  let count = 0;
  if (input.systemEnabled && input.systemContent.trim() !== "") {
    count += 1;
  }
  count += input.dynamic.filter(
    (_, index) => index !== options?.excludeDynamicIndex
  ).length;
  return count;
}

/** 统计表单中有效 Prompt 来源数量（删除块时校验下限）。 */
export function countFormPromptSources(
  input: Pick<
    AgentEditorFormInput,
    "systemEnabled" | "systemContent" | "workplace" | "persist" | "dynamic"
  >,
  options?: {
    excludePersistTextIndex?: number;
    excludeDynamicIndex?: number;
  }
): number {
  let count = 0;
  if (input.systemEnabled && input.systemContent.trim() !== "") {
    count += 1;
  }
  const { textBlocks } = splitPersistBlocksForEditor(input.persist);
  count += textBlocks.filter(
    (_, index) => index !== options?.excludePersistTextIndex
  ).length;
  if (input.workplace === true) {
    count += 1;
  }
  count += input.dynamic.filter(
    (_, index) => index !== options?.excludeDynamicIndex
  ).length;
  return count;
}

export function createDefaultPersistTextBlock(
  index: number
): PersistTextPromptBlock {
  return {
    name: `persist-${index + 1}`,
    type: "text",
    role: "user",
    content: "",
  };
}

export function createDefaultDynamicTextBlock(
  index: number
): DynamicPromptBlock {
  return {
    name: `dynamic-${index + 1}`,
    type: "text",
    role: "user",
    content: "",
  };
}

/** AgentDefinition → 编辑器表单 Prompt 字段。 */
export function definitionToForm(
  def: AgentDefinition
): Pick<
  AgentEditorFormInput,
  | "systemEnabled"
  | "systemContent"
  | "persistEnabled"
  | "dynamicEnabled"
  | "workplace"
  | "persist"
  | "dynamic"
> {
  const system = def.prompts.system?.trim() ?? "";
  return {
    systemEnabled: system.length > 0,
    systemContent: def.prompts.system ?? "",
    persistEnabled: def.prompts.persistEnabled ?? false,
    dynamicEnabled: def.prompts.dynamicEnabled ?? false,
    workplace: layoutHasWorkplace(def.prompts),
    persist: [...def.prompts.persist],
    dynamic: [...def.prompts.dynamic],
  };
}

/** 表单 Prompt 字段 → {@link AgentPromptLayout}（system 关闭时 omit）。 */
export function layoutFromFormInput(
  input: Pick<
    AgentEditorFormInput,
    | "systemEnabled"
    | "systemContent"
    | "persistEnabled"
    | "dynamicEnabled"
    | "workplace"
    | "persist"
    | "dynamic"
  >
): AgentPromptLayout {
  const system =
    input.systemEnabled && input.systemContent.trim() !== ""
      ? input.systemContent
      : undefined;
  const { textBlocks } = splitPersistBlocksForEditor(input.persist);
  return {
    ...(system != null ? { system } : {}),
    ...(input.persistEnabled ? { persistEnabled: true } : {}),
    ...(input.dynamicEnabled ? { dynamicEnabled: true } : {}),
    // 过渡：表单仍为 boolean；开 → 预填默认确认语（Step 6 再拆 assistantText）
    ...(input.workplace
      ? { workplace: DEFAULT_WORKPLACE_ASSISTANT_TEXT }
      : {}),
    persist: [...textBlocks],
    dynamic: [...input.dynamic],
  };
}

/** Stable JSON for dirty check; omits model ids when专属模型 is off. */
export function formSnapshotJson(input: AgentEditorFormInput): string {
  return JSON.stringify({
    name: input.name,
    maxSteps: input.maxSteps,
    modelEnabled: input.modelEnabled,
    toolsMode: input.toolsMode,
    toolsSelected: input.toolsSelected,
    ...(input.modelEnabled
      ? {
          providerId: input.providerId,
          savedModelId: input.savedModelId,
        }
      : {}),
    systemEnabled: input.systemEnabled,
    systemContent: input.systemContent,
    persistEnabled: input.persistEnabled,
    dynamicEnabled: input.dynamicEnabled,
    workplace: input.workplace,
    persist: input.persist,
    dynamic: input.dynamic,
  });
}

export function buildAgentDefinitionFromForm(
  input: AgentEditorFormInput
): { ok: true; definition: AgentDefinition } | { ok: false; message: string } {
  if (!input.name.trim()) {
    return { ok: false, message: "请填写 Agent 名称" };
  }
  if (hasAnyPromptRegionEnabled(input) && !hasEffectivePromptSource(input)) {
    return { ok: false, message: "至少保留一个 Prompt 块" };
  }
  const layout = layoutFromFormInput(input);
  let validatedLayout: AgentPromptLayout;
  try {
    validatedLayout = validateAgentPromptLayout(layout);
  } catch (error) {
    if (error instanceof PromptError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
  const steps = Number(input.maxSteps);
  const tools = buildToolsPolicyFromSelection(
    input.toolsMode,
    input.toolsSelected
  );
  let modelPin: string | undefined;
  if (input.modelEnabled && input.savedModelId.trim()) {
    const trimmed = input.savedModelId.trim();
    if (!isSavedModelUuidFormat(trimmed)) {
      return { ok: false, message: "专属模型须为已保存模型的 UUID" };
    }
    modelPin = trimmed;
  }
  const def: AgentDefinition = {
    name: input.name.trim(),
    prompts: validatedLayout,
    ...(Number.isFinite(steps) && steps > 0
      ? { runtime: { maxSteps: steps } }
      : {}),
    ...(modelPin != null ? { model: modelPin } : {}),
    ...(tools != null ? { tools } : {}),
  };
  return { ok: true, definition: def };
}
