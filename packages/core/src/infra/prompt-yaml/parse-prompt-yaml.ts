/**
 * Parses prompt definition YAML into validated {@link PromptBlock} models.
 *
 * @module infra/prompt-yaml/parse-prompt-yaml
 */

import { parse as parseYaml } from "yaml";
import { validatePromptBlocks } from "../../domain/prompt/prompt-blocks-validate.js";
import type { PromptBlock } from "../../domain/prompt/model/prompt-block.js";
import { PromptError } from "../../errors/prompt-errors.js";

/**
 * Parses YAML source and returns validated prompt blocks in file order.
 */
export function parsePromptYaml(source: string): readonly PromptBlock[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "invalid YAML";
    throw new PromptError("INVALID_YAML", message);
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PromptError("INVALID_YAML", "prompt root must be an object");
  }

  const blocks = (parsed as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks)) {
    throw new PromptError("INVALID_YAML", "prompt root must contain a blocks array");
  }

  return validatePromptBlocks(blocks);
}
