/**
 * CLI: 从 YAML 加载 {@link AgentPromptLayout}（--prompt-path 快捷方式）。
 *
 * @module config/load-agent-prompt-layout
 */

import {
  decode,
  parseText,
  promptsDocumentSchema,
  validateAgentPromptLayoutFromMaps,
  type AgentPromptLayout,
} from "@novel-master/core";
import { PromptError } from "@novel-master/core";

function extractPromptsRecord(parsed: unknown): unknown {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PromptError("INVALID_YAML", "prompt root must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.persist != null ||
    record.dynamic != null ||
    record.system != null
  ) {
    return record;
  }
  const nested = record.prompts;
  if (nested != null && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }
  throw new PromptError(
    "INVALID_YAML",
    "prompt root must contain prompts.system / persist / dynamic",
  );
}

/** 解析 YAML 中的三区 prompts 文档。 */
export function loadAgentPromptLayoutFromYaml(source: string): AgentPromptLayout {
  let parsed: unknown;
  try {
    parsed = parseText(source, "yaml");
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid YAML";
    throw new PromptError("INVALID_YAML", message);
  }

  const promptsRaw = extractPromptsRecord(parsed);
  const doc = decode(promptsRaw, promptsDocumentSchema);
  return validateAgentPromptLayoutFromMaps(
    doc.persist,
    doc.dynamic,
    doc.system,
  );
}
