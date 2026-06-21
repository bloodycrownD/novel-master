/**
 * Agent Prompt 三区布局校验（wire map → 领域模型）。
 *
 * @module domain/prompt/logic/validate-agent-prompt-layout
 */

import { PromptError } from "@/errors/prompt-errors.js";
import type {
  AgentPromptLayout,
  DynamicPromptBlock,
  PersistPromptBlock,
} from "../model/agent-prompt-layout.js";
import type { PromptBlockLifecycle } from "../model/prompt-block.js";
import {
  dynamicBlockToWire,
  persistBlockToWire,
} from "./agent-prompt-layout-wire.js";
import {
  rejectPersistMacros,
  validateDynamicMacros,
} from "./validate-dynamic-macros.js";

const LIFECYCLES = new Set<PromptBlockLifecycle>(["always", "once"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function blockLabel(name: string): string {
  return `块「${name}」`;
}

function rejectWhen(label: string, record: Record<string, unknown>): void {
  if ("when" in record) {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}：不再支持 when 字段，请删除`,
    );
  }
}

function parsePersistBlock(name: string, item: unknown): PersistPromptBlock {
  if (item == null || typeof item !== "object" || Array.isArray(item)) {
    throw new PromptError("INVALID_BLOCK", `${blockLabel(name)}须为对象`);
  }
  const record = item as Record<string, unknown>;
  const type = record.type;
  if (!isNonEmptyString(type)) {
    throw new PromptError("INVALID_BLOCK", `${blockLabel(name)}须指定 type`);
  }
  const label = blockLabel(name);
  rejectWhen(label, record);

  if (type === "worktree") {
    if ("content" in record || "lifecycle" in record) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}：worktree 块不得包含 content 或 lifecycle`,
      );
    }
    let role: "user" | "assistant" = "user";
    if ("role" in record && record.role != null) {
      const wireRole = record.role;
      if (wireRole !== "user" && wireRole !== "assistant") {
        throw new PromptError(
          "INVALID_BLOCK",
          `${label}：worktree 块的 role 须为 user 或 assistant`,
        );
      }
      role = wireRole;
    }
    return { name, type: "worktree", role };
  }

  if (type === "text") {
    const role = record.role;
    if (role === "system") {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}：持久区文本块不得使用 system 角色，请改用 prompts.system`,
      );
    }
    if (role !== "user" && role !== "assistant") {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}：持久区文本块的 role 须为 user 或 assistant`,
      );
    }
    if (typeof record.content !== "string") {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}：文本块须为字符串 content`,
      );
    }
    if ("lifecycle" in record) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}：持久区文本块不得包含 lifecycle`,
      );
    }
    rejectPersistMacros(record.content, label);
    return {
      name,
      type: "text",
      role,
      content: record.content,
    };
  }

  throw new PromptError("INVALID_BLOCK", `${label}：未知类型「${type}」`);
}

function parseDynamicBlock(name: string, item: unknown): DynamicPromptBlock {
  if (item == null || typeof item !== "object" || Array.isArray(item)) {
    throw new PromptError("INVALID_BLOCK", `${blockLabel(name)}须为对象`);
  }
  const record = item as Record<string, unknown>;
  const type = record.type;
  if (type !== "text") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${blockLabel(name)}：动态区块须为 text 类型`,
    );
  }
  const label = blockLabel(name);
  rejectWhen(label, record);

  const role = record.role;
  if (role === "system") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}：动态区文本块不得使用 system 角色`,
    );
  }
  if (role !== "user" && role !== "assistant") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}：动态区文本块的 role 须为 user 或 assistant`,
    );
  }
  if (typeof record.content !== "string") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}：文本块须为字符串 content`,
    );
  }

  let lifecycle: PromptBlockLifecycle | undefined;
  if ("lifecycle" in record && record.lifecycle != null) {
    const lc = record.lifecycle;
    if (typeof lc !== "string" || !LIFECYCLES.has(lc as PromptBlockLifecycle)) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}：lifecycle 须为 always 或 once`,
      );
    }
    if (lc === "once") {
      lifecycle = "once";
    }
  }

  validateDynamicMacros(record.content, label);

  return {
    name,
    type: "text",
    role,
    content: record.content,
    ...(lifecycle != null ? { lifecycle } : {}),
  };
}

function validateBlockMap(raw: unknown, region: "persist" | "dynamic"): unknown {
  if (Array.isArray(raw)) {
    throw new PromptError(
      "INVALID_YAML",
      `prompts.${region} 须为对象映射，不能是数组`,
    );
  }
  if (raw == null || typeof raw !== "object") {
    throw new PromptError(
      "INVALID_YAML",
      `prompts.${region} 须为对象映射`,
    );
  }
  return raw;
}

/**
 * 将 wire `persist` / `dynamic` map 校验为 {@link AgentPromptLayout}。
 */
export function validateAgentPromptLayoutFromMaps(
  persistRaw: unknown,
  dynamicRaw: unknown,
  system?: string,
  options?: {
    readonly persistEnabled?: boolean;
    readonly dynamicEnabled?: boolean;
  },
): AgentPromptLayout {
  if (system != null && system.trim() === "") {
    throw new PromptError(
      "INVALID_BLOCK",
      "prompts.system 如填写则须为非空字符串",
    );
  }

  const persistMap = validateBlockMap(persistRaw, "persist") as Record<
    string,
    unknown
  >;
  const dynamicMap = validateBlockMap(dynamicRaw, "dynamic") as Record<
    string,
    unknown
  >;

  const persist: PersistPromptBlock[] = [];
  for (const [name, item] of Object.entries(persistMap)) {
    if (!isNonEmptyString(name)) {
      throw new PromptError("INVALID_BLOCK", "块名称须为非空字符串");
    }
    persist.push(parsePersistBlock(name, item));
  }

  const worktreeBlocks = persist.filter((b) => b.type === "worktree");
  if (worktreeBlocks.length > 1) {
    throw new PromptError(
      "INVALID_YAML",
      "prompts.persist 最多只能有一个 worktree 块",
    );
  }

  const dynamic: DynamicPromptBlock[] = [];
  for (const [name, item] of Object.entries(dynamicMap)) {
    if (!isNonEmptyString(name)) {
      throw new PromptError("INVALID_BLOCK", "块名称须为非空字符串");
    }
    dynamic.push(parseDynamicBlock(name, item));
  }

  const persistEnabled = options?.persistEnabled === true;
  const dynamicEnabled = options?.dynamicEnabled === true;

  if (persistEnabled) {
    if (persist.length < 1) {
      throw new PromptError(
        "INVALID_YAML",
        "启用持久区时至少需要一个块",
      );
    }
    const last = persist[persist.length - 1]!;
    if (persistBlockRole(last) !== "assistant") {
      throw new PromptError(
        "INVALID_YAML",
        "启用持久区时最后一个块须为助手角色",
      );
    }
  }

  if (dynamicEnabled) {
    if (dynamic.length < 2) {
      throw new PromptError(
        "INVALID_YAML",
        "启用动态区时至少需要两个块",
      );
    }
    const first = dynamic[0]!;
    const last = dynamic[dynamic.length - 1]!;
    if (first.role !== "assistant") {
      throw new PromptError(
        "INVALID_YAML",
        "启用动态区时第一个块须为助手角色",
      );
    }
    if (last.role !== "user") {
      throw new PromptError(
        "INVALID_YAML",
        "启用动态区时最后一个块须为用户角色",
      );
    }
  }

  return {
    ...(system != null && system.trim() !== "" ? { system } : {}),
    ...(persistEnabled ? { persistEnabled: true } : {}),
    ...(dynamicEnabled ? { dynamicEnabled: true } : {}),
    persist,
    dynamic,
  };
}

function persistBlockRole(block: PersistPromptBlock): "user" | "assistant" {
  if (block.type === "worktree") {
    return block.role ?? "user";
  }
  return block.role;
}

function assertUniqueBlockNames(
  blocks: readonly { readonly name: string }[],
  region: "persist" | "dynamic",
): void {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.name)) {
      throw new PromptError(
        "INVALID_BLOCK",
        `prompts.${region}：重复的块名「${block.name}」`,
      );
    }
    seen.add(block.name);
  }
}

/**
 * 校验已组装的 {@link AgentPromptLayout}（表单保存 / upsert 路径与 decode 规则一致）。
 */
export function validateAgentPromptLayout(
  layout: AgentPromptLayout,
): AgentPromptLayout {
  assertUniqueBlockNames(layout.persist, "persist");
  assertUniqueBlockNames(layout.dynamic, "dynamic");

  const persistMap: Record<string, unknown> = {};
  for (const block of layout.persist) {
    persistMap[block.name] = persistBlockToWire(block);
  }
  const dynamicMap: Record<string, unknown> = {};
  for (const block of layout.dynamic) {
    dynamicMap[block.name] = dynamicBlockToWire(block);
  }

  return validateAgentPromptLayoutFromMaps(
    persistMap,
    dynamicMap,
    layout.system,
    {
      persistEnabled: layout.persistEnabled,
      dynamicEnabled: layout.dynamicEnabled,
    },
  );
}
