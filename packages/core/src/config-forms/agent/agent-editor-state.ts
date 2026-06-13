import type { AgentDefinition, AgentToolPolicy } from "@/domain/agent/model/agent-definition.js";
import type {
  AgentPromptLayout,
  DynamicPromptBlock,
  PersistPromptBlock,
  PersistTextPromptBlock,
  PersistWorktreePromptBlock,
} from "@/domain/prompt/model/agent-prompt-layout.js";
import { formatApplicationModelId } from "../shared/application-model-id.js";
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

export const ROLE_OPTIONS = PROMPT_BLOCK_ROLES.map((role) => ({
  value: role,
  label: role,
}));

/** Agent 编辑器表单（三区 layout，非扁平 prompts）。 */
export type AgentEditorFormInput = {
  name: string;
  maxSteps: string;
  modelEnabled: boolean;
  providerId: string;
  vendorModelId: string;
  toolsMode: ToolsMode;
  toolsSelected: readonly string[];
  systemEnabled: boolean;
  systemContent: string;
  persist: readonly PersistPromptBlock[];
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
  listText: string,
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

export function blockTypeLabel(
  type: PersistPromptBlock["type"] | DynamicPromptBlock["type"],
): string {
  if (type === "worktree") {
    return "Worktree";
  }
  return "文本";
}

type DynamicTextBlock = DynamicPromptBlock;

/** dynamic 文本块是否在每轮 agent step 带入（lifecycle always）。 */
export function isDynamicBlockPersistent(block: DynamicTextBlock): boolean {
  return (block.lifecycle ?? "always") === "always";
}

/** 将 UI「常驻」开关映射为 lifecycle（常驻时省略字段）。 */
export function withDynamicBlockPersistence(
  block: DynamicTextBlock,
  persistent: boolean,
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
  "systemEnabled" | "systemContent" | "persist" | "dynamic"
> {
  return {
    systemEnabled: false,
    systemContent: "",
    persist: [createDefaultPersistTextBlock(0)],
    dynamic: [],
  };
}

export function createDefaultPersistTextBlock(index: number): PersistTextPromptBlock {
  return {
    name: `persist-${index + 1}`,
    type: "text",
    role: "user",
    content: "",
  };
}

export function createDefaultWorktreeBlock(index = 0): PersistWorktreePromptBlock {
  return {
    name: index === 0 ? "canon" : `worktree-${index + 1}`,
    type: "worktree",
  };
}

export function createDefaultDynamicTextBlock(index: number): DynamicPromptBlock {
  return {
    name: `dynamic-${index + 1}`,
    type: "text",
    role: "user",
    content: "",
  };
}

/** AgentDefinition → 编辑器表单 Prompt 字段。 */
export function definitionToForm(
  def: AgentDefinition,
): Pick<
  AgentEditorFormInput,
  "systemEnabled" | "systemContent" | "persist" | "dynamic"
> {
  const system = def.prompts.system?.trim() ?? "";
  return {
    systemEnabled: system.length > 0,
    systemContent: def.prompts.system ?? "",
    persist: [...def.prompts.persist],
    dynamic: [...def.prompts.dynamic],
  };
}

/** 表单 Prompt 字段 → {@link AgentPromptLayout}（system 关闭时 omit）。 */
export function layoutFromFormInput(
  input: Pick<
    AgentEditorFormInput,
    "systemEnabled" | "systemContent" | "persist" | "dynamic"
  >,
): AgentPromptLayout {
  const system =
    input.systemEnabled && input.systemContent.trim() !== ""
      ? input.systemContent
      : undefined;
  return {
    ...(system != null ? { system } : {}),
    persist: [...input.persist],
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
          vendorModelId: input.vendorModelId,
        }
      : {}),
    systemEnabled: input.systemEnabled,
    systemContent: input.systemContent,
    persist: input.persist,
    dynamic: input.dynamic,
  });
}

export function buildAgentDefinitionFromForm(
  input: AgentEditorFormInput,
): { ok: true; definition: AgentDefinition } | { ok: false; message: string } {
  if (!input.name.trim()) {
    return { ok: false, message: "请填写 Agent 名称" };
  }
  const layout = layoutFromFormInput(input);
  if (
    layout.system == null &&
    layout.persist.length === 0 &&
    layout.dynamic.length === 0
  ) {
    return { ok: false, message: "至少保留一个 Prompt 块" };
  }
  const steps = Number(input.maxSteps);
  const tools = buildToolsPolicyFromSelection(input.toolsMode, input.toolsSelected);
  const def: AgentDefinition = {
    name: input.name.trim(),
    prompts: layout,
    ...(Number.isFinite(steps) && steps > 0 ? { runtime: { maxSteps: steps } } : {}),
    ...(input.modelEnabled && input.providerId && input.vendorModelId
      ? { model: formatApplicationModelId(input.providerId, input.vendorModelId) }
      : {}),
    ...(tools != null ? { tools } : {}),
  };
  return { ok: true, definition: def };
}
