/**
 * Runtime validation of parsed YAML blocks into {@link PromptBlock}.
 *
 * @module domain/prompt/prompt-blocks-validate
 */

import { PromptError } from "../../errors/prompt-errors.js";
import type { PromptBlock, PromptBlockRole } from "./model/prompt-block.js";

const ROLES = new Set<PromptBlockRole>(["system", "user", "assistant"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function blockLabel(index: number, name: unknown): string {
  return typeof name === "string" && name.length > 0
    ? `block "${name}"`
    : `block[${index}]`;
}

function rejectWhen(label: string, record: Record<string, unknown>): void {
  if ("when" in record) {
    throw new PromptError(
      "INVALID_BLOCK",
      `${label}: when is no longer supported; use type abstract for conditional summary blocks`,
    );
  }
}

/**
 * Validates raw `blocks` array entries into typed {@link PromptBlock} models.
 */
export function validatePromptBlocks(raw: unknown): readonly PromptBlock[] {
  if (!Array.isArray(raw)) {
    throw new PromptError("INVALID_YAML", "prompt root must contain a blocks array");
  }

  const blocks: PromptBlock[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${blockLabel(i, undefined)} must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    const name = record.name;
    const type = record.type;

    if (!isNonEmptyString(name)) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${blockLabel(i, name)} requires non-empty name`,
      );
    }
    if (!isNonEmptyString(type)) {
      throw new PromptError(
        "INVALID_BLOCK",
        `${blockLabel(i, name)} requires type`,
      );
    }

    const label = blockLabel(i, name);
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
      blocks.push({
        name,
        type: "text",
        role: role as PromptBlockRole,
        content: record.content,
      });
      continue;
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
      blocks.push({ name, type: "chat" });
      continue;
    }

    if (type === "abstract") {
      if ("role" in record) {
        throw new PromptError(
          "INVALID_BLOCK",
          `${label}: abstract block must not include role`,
        );
      }
      if (typeof record.content !== "string") {
        throw new PromptError(
          "INVALID_BLOCK",
          `${label}: abstract block requires string content`,
        );
      }
      blocks.push({ name, type: "abstract", content: record.content });
      continue;
    }

    throw new PromptError("INVALID_BLOCK", `${label}: unknown type "${type}"`);
  }

  return blocks;
}
