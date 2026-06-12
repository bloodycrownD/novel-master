import type { AgentDefinition, AgentToolPolicy } from "@/domain/agent/model/agent-definition.js";
import type { PromptBlock, PromptBlockRole } from "@/domain/prompt/model/prompt-block.js";
import { formatApplicationModelId } from "../shared/application-model-id.js";
import {
  buildToolsPolicyFromSelection,
  toolsSelectionFromDefinition,
} from "./agent-tool-catalog.js";

export type ToolsMode = "default" | "allow" | "deny";

export const PROMPT_BLOCK_ROLES = ["system", "user", "assistant"] as const;

export const TOOL_MODE_OPTIONS: Array<{ value: ToolsMode; label: string }> = [
  { value: "default", label: "默认（全部工具）" },
  { value: "allow", label: "白名单" },
  { value: "deny", label: "黑名单" },
];

export const ROLE_OPTIONS = PROMPT_BLOCK_ROLES.map((role) => ({
  value: role,
  label: role,
}));

export type AgentEditorFormInput = {
  name: string;
  maxSteps: string;
  modelEnabled: boolean;
  providerId: string;
  vendorModelId: string;
  toolsMode: ToolsMode;
  toolsSelected: readonly string[];
  prompts: readonly PromptBlock[];
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

export function blockTypeLabel(type: PromptBlock["type"]): string {
  return type === "text" ? "文本" : "会话";
}

/** Drop removed `abstract` blocks from legacy agent configs. */
export function stripRemovedPromptBlocks(
  blocks: readonly PromptBlock[],
): { readonly prompts: PromptBlock[]; readonly removed: number } {
  const kept: PromptBlock[] = [];
  let removed = 0;
  for (const block of blocks) {
    if ((block as { type: string }).type === "abstract") {
      removed += 1;
      continue;
    }
    kept.push(block);
  }
  return { prompts: kept, removed };
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
    prompts: input.prompts,
  });
}

export function buildAgentDefinitionFromForm(
  input: AgentEditorFormInput,
): { ok: true; definition: AgentDefinition } | { ok: false; message: string } {
  if (!input.name.trim()) {
    return { ok: false, message: "请填写 Agent 名称" };
  }
  if (input.prompts.length === 0) {
    return { ok: false, message: "至少保留一个 Prompt 块" };
  }
  const steps = Number(input.maxSteps);
  const tools = buildToolsPolicyFromSelection(input.toolsMode, input.toolsSelected);
  const def: AgentDefinition = {
    name: input.name.trim(),
    prompts: [...input.prompts],
    ...(Number.isFinite(steps) && steps > 0 ? { runtime: { maxSteps: steps } } : {}),
    ...(input.modelEnabled && input.providerId && input.vendorModelId
      ? { model: formatApplicationModelId(input.providerId, input.vendorModelId) }
      : {}),
    ...(tools != null ? { tools } : {}),
  };
  return { ok: true, definition: def };
}

export function createDefaultTextBlock(index: number): PromptBlock {
  return {
    name: `block-${index + 1}`,
    type: "text",
    role: "system" as PromptBlockRole,
    content: "",
  };
}

export function createDefaultChatBlock(): PromptBlock {
  return { name: "history", type: "chat" };
}
