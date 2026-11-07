/**
 * Agent Prompt 三区布局校验（wire map → 领域模型）。
 *
 * 校验失败走 `Result`（key `PROMPT_INVALID_LAYOUT` / `PROMPT_INVALID_MACRO`），
 * 本模块不抛；调用方按 `if (!r.ok)` 收窄后自行决定抛还是展示。
 *
 * @module domain/prompt/logic/validate-agent-prompt-layout
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { AgentPromptLayout, DynamicPromptBlock, PersistTextPromptBlock } from "../model/agent-prompt-layout.js";
import { WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT } from "../model/agent-prompt-layout.js";
import { dynamicBlockToWire, persistBlockToWire } from "./agent-prompt-layout-wire.js";
import { stripLegacyWorktreeBlocksFromPersistMap } from "./normalize-agent-prompt-layout.js";
import { rejectPersistMacros, validateDynamicMacros } from "./validate-dynamic-macros.js";

/** 本模块的领域失败：布局结构不合法，或布局内的宏不合法。 */
type PromptLayoutError = AppError<"PROMPT_INVALID_LAYOUT" | "PROMPT_INVALID_MACRO">;

/** wire 布局的开关与可选字段（缺省语义见各字段注释）。 */
interface AgentPromptLayoutWireOptions {
  readonly persistEnabled?: boolean;
  readonly dynamicEnabled?: boolean;
  /** wire：`boolean | string`；域开 = 非空 string。 */
  readonly workplace?: boolean | string;
  /** 自定义附加信息纯文本；trim 后空视为关（不注入）。 */
  readonly customAttach?: string;
  /** 技能能力总开关；缺省 true。`false` 时不注入技能索引且不注册 skill 工具。 */
  readonly skillsEnabled?: boolean;
  /** 技能索引前缀语；trim 后空视为默认（不写域字段）。 */
  readonly skillsPrefix?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * 将 wire `prompts.workplace`（`boolean | string`）归一为域内非空 string；关则 `undefined`。
 * 失败：空串 / 仅空白 / 非 boolean 非 string。
 */
export function resolveWorkplaceFromWire(workplace: boolean | string | undefined): Result<string | undefined, PromptLayoutError> {
  if (workplace === undefined || workplace === false) {
    return Result.ok(undefined);
  }
  if (workplace === true) {
    return Result.ok(WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT);
  }
  if (typeof workplace === "string") {
    if (workplace.trim().length < 1) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.workplace_nonempty_string" }));
    }
    return Result.ok(workplace);
  }
  return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.workplace_type" }));
}

function blockLabel(name: string): string {
  return `块「${name}」`;
}

function validateBlockMap(raw: unknown, region: "persist" | "dynamic"): Result<Record<string, unknown>, PromptLayoutError> {
  if (Array.isArray(raw)) {
    return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.region_map_not_array", params: { region } }));
  }
  if (raw == null || typeof raw !== "object") {
    return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.region_map_required", params: { region } }));
  }
  return Result.ok(raw as Record<string, unknown>);
}

/**
 * 将 wire `persist` / `dynamic` map 校验为 {@link AgentPromptLayout}。
 */
export function validateAgentPromptLayoutFromMaps(persistRaw: unknown, dynamicRaw: unknown, system?: string, options?: AgentPromptLayoutWireOptions): Result<AgentPromptLayout, PromptLayoutError> {
  if (system != null && system.trim() === "") {
    return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.system_nonempty_string" }));
  }

  const persistMapRaw = validateBlockMap(persistRaw, "persist");
  if (!persistMapRaw.ok) {
    return Result.err(persistMapRaw.error);
  }
  const persistMap = stripLegacyWorktreeBlocksFromPersistMap(persistMapRaw.value);
  const dynamicMapResult = validateBlockMap(dynamicRaw, "dynamic");
  if (!dynamicMapResult.ok) {
    return Result.err(dynamicMapResult.error);
  }
  const dynamicMap = dynamicMapResult.value;

  const persist: PersistTextPromptBlock[] = [];
  for (const [name, item] of Object.entries(persistMap)) {
    if (!isNonEmptyString(name)) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.block_name_required" }));
    }
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.block_not_object", params: { block: blockLabel(name) } }));
    }
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type !== "text") {
      if (type === "worktree") {
        return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.persist_worktree_removed", params: { block: blockLabel(name) } }));
      }
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.persist_block_text_only", params: { block: blockLabel(name) } }));
    }
    const label = blockLabel(name);
    if ("when" in record) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.when_removed", params: { block: label } }));
    }
    const role = record.role;
    if (role === "system") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.persist_system_role", params: { block: label } }));
    }
    if (role !== "user" && role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.persist_role", params: { block: label } }));
    }
    if (typeof record.content !== "string") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.text_content_required", params: { block: label } }));
    }
    const macros = rejectPersistMacros(record.content, label);
    if (!macros.ok) {
      return Result.err(macros.error);
    }
    persist.push({ name, type: "text", role, content: record.content });
  }

  const dynamic: DynamicPromptBlock[] = [];
  for (const [name, item] of Object.entries(dynamicMap)) {
    if (!isNonEmptyString(name)) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.block_name_required" }));
    }
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.block_not_object", params: { block: blockLabel(name) } }));
    }
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type !== "text") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.dynamic_block_text_only", params: { block: blockLabel(name) } }));
    }
    const label = blockLabel(name);
    if ("when" in record) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.when_removed", params: { block: label } }));
    }
    const role = record.role;
    if (role === "system") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.dynamic_system_role", params: { block: label } }));
    }
    if (role !== "user" && role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.dynamic_role", params: { block: label } }));
    }
    if (typeof record.content !== "string") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.text_content_required", params: { block: label } }));
    }
    const macros = validateDynamicMacros(record.content, label);
    if (!macros.ok) {
      return Result.err(macros.error);
    }
    dynamic.push({ name, type: "text", role, content: record.content });
  }

  const persistEnabled = options?.persistEnabled === true;
  const dynamicEnabled = options?.dynamicEnabled === true;
  const workplace = resolveWorkplaceFromWire(options?.workplace);
  if (!workplace.ok) {
    return Result.err(workplace.error);
  }
  const customAttachRaw = options?.customAttach;
  const customAttach = typeof customAttachRaw === "string" && customAttachRaw.trim().length > 0 ? customAttachRaw : undefined;
  if (customAttach != null) {
    // customAttach 宏白名单与动态区一致（time/week_cn/filetree）。
    const macros = validateDynamicMacros(customAttach, { key: "label.agent.custom_attach" });
    if (!macros.ok) {
      return Result.err(macros.error);
    }
  }

  if (persistEnabled) {
    if (persist.length < 1) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.persist_needs_blocks" }));
    }
    const last = persist[persist.length - 1]!;
    if (last.role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.persist_last_role" }));
    }
  }

  if (dynamicEnabled) {
    if (dynamic.length < 2) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.dynamic_needs_two_blocks" }));
    }
    const first = dynamic[0]!;
    const last = dynamic[dynamic.length - 1]!;
    if (first.role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.dynamic_first_role" }));
    }
    if (last.role !== "user") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.dynamic_last_role" }));
    }
  }

  return Result.ok({
    ...(system != null && system.trim() !== "" ? { system } : {}),
    ...(persistEnabled ? { persistEnabled: true } : {}),
    ...(dynamicEnabled ? { dynamicEnabled: true } : {}),
    ...(workplace.value != null ? { workplace: workplace.value } : {}),
    ...(customAttach != null ? { customAttach } : {}),
    ...(options?.skillsEnabled === false ? { skillsEnabled: false } : {}),
    ...(() => {
      const prefixRaw = options?.skillsPrefix;
      return typeof prefixRaw === "string" && prefixRaw.trim().length > 0 ? { skillsPrefix: prefixRaw } : {};
    })(),
    persist,
    dynamic,
  });
}

function validateUniqueBlockNames(blocks: readonly { readonly name: string }[], region: "persist" | "dynamic"): Result<void, PromptLayoutError> {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.name)) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", { key: "error.prompt.invalid_layout.duplicate_block_name", params: { region, name: block.name } }));
    }
    seen.add(block.name);
  }
  return Result.ok(undefined);
}

/**
 * 校验已组装的 {@link AgentPromptLayout}（表单保存 / upsert 路径与 decode 规则一致）。
 */
export function validateAgentPromptLayout(layout: AgentPromptLayout): Result<AgentPromptLayout, PromptLayoutError> {
  const persistNames = validateUniqueBlockNames(layout.persist, "persist");
  if (!persistNames.ok) {
    return Result.err(persistNames.error);
  }
  const dynamicNames = validateUniqueBlockNames(layout.dynamic, "dynamic");
  if (!dynamicNames.ok) {
    return Result.err(dynamicNames.error);
  }

  const persistMap: Record<string, unknown> = {};
  for (const block of layout.persist) {
    persistMap[block.name] = persistBlockToWire(block);
  }
  const dynamicMap: Record<string, unknown> = {};
  for (const block of layout.dynamic) {
    dynamicMap[block.name] = dynamicBlockToWire(block);
  }

  return validateAgentPromptLayoutFromMaps(persistMap, dynamicMap, layout.system, {
    persistEnabled: layout.persistEnabled,
    dynamicEnabled: layout.dynamicEnabled,
    workplace: layout.workplace,
    customAttach: layout.customAttach,
    skillsEnabled: layout.skillsEnabled,
    skillsPrefix: layout.skillsPrefix,
  });
}
