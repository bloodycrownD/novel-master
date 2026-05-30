/**
 * Loads only `prompts.blocks` from YAML (--prompt-path test shortcut).
 *
 * @module domain/prompt/load-prompt-blocks-from-yaml
 */

import { parseText } from "@/infra/serialization/parse-text.js";
import { validatePromptBlocksFromMap } from "./prompt-blocks-validate.js";
import type { PromptBlock } from "./model/prompt-block.js";
import { PromptError } from "@/errors/prompt-errors.js";

/**
 * Parses YAML containing `blocks` map at root or under `prompts.blocks`.
 */
export function loadPromptBlocksFromYaml(source: string): readonly PromptBlock[] {
  let parsed: unknown;
  try {
    parsed = parseText(source, "yaml");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid YAML";
    throw new PromptError("INVALID_YAML", message);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PromptError("INVALID_YAML", "prompt root must be an object");
  }

  const record = parsed as Record<string, unknown>;
  let blocks: unknown = record.blocks;
  if (
    (blocks == null || typeof blocks !== "object" || Array.isArray(blocks)) &&
    record.prompts != null
  ) {
    const prompts = record.prompts;
    if (prompts != null && typeof prompts === "object" && !Array.isArray(prompts)) {
      blocks = (prompts as Record<string, unknown>).blocks;
    }
  }

  if (blocks == null || typeof blocks !== "object" || Array.isArray(blocks)) {
    throw new PromptError("INVALID_YAML", "prompt root must contain a blocks mapping");
  }

  return validatePromptBlocksFromMap(blocks);
}
