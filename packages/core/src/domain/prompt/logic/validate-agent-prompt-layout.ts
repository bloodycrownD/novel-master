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
  rejectPersistMacros,
  validateDynamicMacros,
} from "./validate-dynamic-macros.js";

const LIFECYCLES = new Set<PromptBlockLifecycle>(["always", "once"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function blockLabel(name: string): string {
  return `block "${name}"`;
}

function rejectWhen(label: string, record: Record<string, unknown>): void {
  if ("when" in record) {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}: when is no longer supported; remove the when field`,
    );
  }
}

function parsePersistBlock(name: string, item: unknown): PersistPromptBlock {
  if (item == null || typeof item !== "object" || Array.isArray(item)) {
    throw new PromptError("INVALID_BLOCK", `${blockLabel(name)} must be an object`);
  }
  const record = item as Record<string, unknown>;
  const type = record.type;
  if (!isNonEmptyString(type)) {
    throw new PromptError("INVALID_BLOCK", `${blockLabel(name)} requires type`);
  }
  const label = blockLabel(name);
  rejectWhen(label, record);

  if (type === "worktree") {
    if ("role" in record || "content" in record || "lifecycle" in record) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: worktree block must only have type: worktree`,
      );
    }
    return { name, type: "worktree" };
  }

  if (type === "text") {
    const role = record.role;
    if (role === "system") {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: persist text must not use role system; use prompts.system instead`,
      );
    }
    if (role !== "user" && role !== "assistant") {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: persist text requires role user|assistant`,
      );
    }
    if (typeof record.content !== "string") {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: text block requires string content`,
      );
    }
    if ("lifecycle" in record) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: persist text must not include lifecycle`,
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

  throw new PromptError("INVALID_BLOCK", `${label}: unknown type "${type}"`);
}

function parseDynamicBlock(name: string, item: unknown): DynamicPromptBlock {
  if (item == null || typeof item !== "object" || Array.isArray(item)) {
    throw new PromptError("INVALID_BLOCK", `${blockLabel(name)} must be an object`);
  }
  const record = item as Record<string, unknown>;
  const type = record.type;
  if (type !== "text") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${blockLabel(name)}: dynamic blocks must be type text`,
    );
  }
  const label = blockLabel(name);
  rejectWhen(label, record);

  const role = record.role;
  if (role === "system") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}: dynamic text must not use role system`,
    );
  }
  if (role !== "user" && role !== "assistant") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}: dynamic text requires role user|assistant`,
    );
  }
  if (typeof record.content !== "string") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}: text block requires string content`,
    );
  }

  let lifecycle: PromptBlockLifecycle | undefined;
  if ("lifecycle" in record && record.lifecycle != null) {
    const lc = record.lifecycle;
    if (typeof lc !== "string" || !LIFECYCLES.has(lc as PromptBlockLifecycle)) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: lifecycle must be always or once`,
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
      `prompts.${region} must be a mapping (object), not an array`,
    );
  }
  if (raw == null || typeof raw !== "object") {
    throw new PromptError(
      "INVALID_YAML",
      `prompts.${region} must be a mapping (object)`,
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
): AgentPromptLayout {
  if (system != null && system.trim() === "") {
    throw new PromptError(
      "INVALID_BLOCK",
      "prompts.system must be a non-empty string when present",
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
      throw new PromptError("INVALID_BLOCK", "block map keys must be non-empty strings");
    }
    persist.push(parsePersistBlock(name, item));
  }

  const worktreeBlocks = persist.filter((b) => b.type === "worktree");
  if (worktreeBlocks.length > 1) {
    throw new PromptError(
      "INVALID_YAML",
      "prompts.persist must contain at most one worktree block",
    );
  }

  const dynamic: DynamicPromptBlock[] = [];
  for (const [name, item] of Object.entries(dynamicMap)) {
    if (!isNonEmptyString(name)) {
      throw new PromptError("INVALID_BLOCK", "block map keys must be non-empty strings");
    }
    dynamic.push(parseDynamicBlock(name, item));
  }

  return {
    ...(system != null && system.trim() !== "" ? { system } : {}),
    persist,
    dynamic,
  };
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
        `prompts.${region}: duplicate block name "${block.name}"`,
      );
    }
    seen.add(block.name);
  }
}

function persistBlockToWire(block: PersistPromptBlock): Record<string, unknown> {
  if (block.type === "worktree") {
    return { type: "worktree" };
  }
  return { type: "text", role: block.role, content: block.content };
}

function dynamicBlockToWire(block: DynamicPromptBlock): Record<string, unknown> {
  return {
    type: "text",
    role: block.role,
    content: block.content,
    ...(block.lifecycle != null ? { lifecycle: block.lifecycle } : {}),
  };
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
  );
}
