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
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "prompts.workplace 如开启则须为非空字符串"));
    }
    return Result.ok(workplace);
  }
  return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "prompts.workplace 须为 boolean 或非空字符串"));
}

function blockLabel(name: string): string {
  return `块「${name}」`;
}

function validateBlockMap(raw: unknown, region: "persist" | "dynamic"): Result<Record<string, unknown>, PromptLayoutError> {
  if (Array.isArray(raw)) {
    return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `prompts.${region} 须为对象映射，不能是数组`));
  }
  if (raw == null || typeof raw !== "object") {
    return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `prompts.${region} 须为对象映射`));
  }
  return Result.ok(raw as Record<string, unknown>);
}

/**
 * 将 wire `persist` / `dynamic` map 校验为 {@link AgentPromptLayout}。
 */
export function validateAgentPromptLayoutFromMaps(persistRaw: unknown, dynamicRaw: unknown, system?: string, options?: AgentPromptLayoutWireOptions): Result<AgentPromptLayout, PromptLayoutError> {
  if (system != null && system.trim() === "") {
    return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "prompts.system 如填写则须为非空字符串"));
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
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "块名称须为非空字符串"));
    }
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${blockLabel(name)}须为对象`));
    }
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type !== "text") {
      if (type === "worktree") {
        return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${blockLabel(name)}：请改用常驻工作区（prompts.workplace）开关`));
      }
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${blockLabel(name)}：持久区须为 text 类型`));
    }
    const label = blockLabel(name);
    if ("when" in record) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：不再支持 when 字段，请删除`));
    }
    const role = record.role;
    if (role === "system") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：持久区文本块不得使用 system 角色，请改用 prompts.system`));
    }
    if (role !== "user" && role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：持久区文本块的 role 须为 user 或 assistant`));
    }
    if (typeof record.content !== "string") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：文本块须为字符串 content`));
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
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "块名称须为非空字符串"));
    }
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${blockLabel(name)}须为对象`));
    }
    const record = item as Record<string, unknown>;
    const type = record.type;
    if (type !== "text") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${blockLabel(name)}：动态区块须为 text 类型`));
    }
    const label = blockLabel(name);
    if ("when" in record) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：不再支持 when 字段，请删除`));
    }
    const role = record.role;
    if (role === "system") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：动态区文本块不得使用 system 角色`));
    }
    if (role !== "user" && role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：动态区文本块的 role 须为 user 或 assistant`));
    }
    if (typeof record.content !== "string") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `${label}：文本块须为字符串 content`));
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
    const macros = validateDynamicMacros(customAttach, "附加信息");
    if (!macros.ok) {
      return Result.err(macros.error);
    }
  }

  if (persistEnabled) {
    if (persist.length < 1) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "启用持久区时至少需要一个文本块"));
    }
    const last = persist[persist.length - 1]!;
    if (last.role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "启用持久区时最后一个块须为助手角色"));
    }
  }

  if (dynamicEnabled) {
    if (dynamic.length < 2) {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "启用动态区时至少需要两个块"));
    }
    const first = dynamic[0]!;
    const last = dynamic[dynamic.length - 1]!;
    if (first.role !== "assistant") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "启用动态区时第一个块须为助手角色"));
    }
    if (last.role !== "user") {
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", "启用动态区时最后一个块须为用户角色"));
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
      return Result.err(new AppError("PROMPT_INVALID_LAYOUT", `prompts.${region}：重复的块名「${block.name}」`));
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
