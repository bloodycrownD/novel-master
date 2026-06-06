/**
 * Runtime validation of parsed YAML blocks into {@link PromptBlock}.
 *
 * @module domain/prompt/logic/validate-prompt-blocks
 */

import { PromptError } from "@/errors/prompt-errors.js";
import type { PromptBlock, PromptBlockRole } from "../model/prompt-block.js";

const ROLES = new Set<PromptBlockRole>(["system", "user", "assistant"]);

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

function validateBlockEntry(
  name: string,
  item: unknown,
): PromptBlock {
  if (item == null || typeof item !== "object" || Array.isArray(item)) {
    throw new PromptError(
      "INVALID_BLOCK",
      `${blockLabel(name)} must be an object`,
    );
  }
  const record = item as Record<string, unknown>;
  const type = record.type;

  if (!isNonEmptyString(type)) {
    throw new PromptError(
      "INVALID_BLOCK",
      `${blockLabel(name)} requires type`,
    );
  }

  const label = blockLabel(name);
  rejectWhen(label, record);

  if (type === "text") {
    const role = record.role;
    if (typeof role !== "string" || !ROLES.has(role as PromptBlockRole)) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: text block requires role system|user|assistant`,
      );
    }
    if (typeof record.content !== "string") {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: text block requires string content`,
      );
    }
    return {
      name,
      type: "text",
      role: role as PromptBlockRole,
      content: record.content,
    };
  }

  if (type === "chat") {
    if ("role" in record) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: chat block must not include role`,
      );
    }
    if ("content" in record) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${label}: chat block must not include content`,
      );
    }
    return { name, type: "chat" };
  }

  if (type === "abstract") {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}: type "abstract" is removed; delete the block and any {{.abstract}} macros`,
    );
  }

  throw new PromptError("INVALID_BLOCK", `${label}: unknown type "${type}"`);
}

/**
 * Validates `prompts.blocks` as an ordered map (key = block name) into {@link PromptBlock}[].
 */
export function validatePromptBlocksFromMap(raw: unknown): readonly PromptBlock[] {
  if (Array.isArray(raw)) {
    throw new PromptError(
      "INVALID_YAML",
      "blocks must be a mapping (object), not an array",
    );
  }
  if (raw == null || typeof raw !== "object") {
    throw new PromptError("INVALID_YAML", "blocks must be a mapping (object)");
  }

  const blocks: PromptBlock[] = [];
  for (const [name, item] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNonEmptyString(name)) {
      throw new PromptError("INVALID_BLOCK", "block map keys must be non-empty strings");
    }
    blocks.push(validateBlockEntry(name, item));
  }
  const chatBlocks = blocks.filter((b) => b.type === "chat");
  if (chatBlocks.length > 1) {
    throw new PromptError(
      "INVALID_YAML",
      "prompt must contain at most one chat block",
    );
  }
  return blocks;
}

/** @alias validatePromptBlocksFromMap */
export const validatePromptBlocks = validatePromptBlocksFromMap;

