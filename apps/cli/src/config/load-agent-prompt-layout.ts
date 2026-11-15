/**
 * CLI: 从 YAML 加载 {@link AgentPromptLayout}（--prompt-path 快捷方式）。
 *
 * @module config/load-agent-prompt-layout
 */

import { decode, parseText } from "@novel-master/core";
import { AppError, promptsDocumentSchema } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { validateAgentPromptLayoutFromMaps, type AgentPromptLayout } from "@novel-master/core/prompt";

function extractPromptsRecord(parsed: unknown): unknown {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("PROMPT_INVALID_YAML", { detail: "prompt root must be an object" });
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
  throw new AppError("PROMPT_INVALID_YAML", { detail: "prompt root must contain prompts.system / persist / dynamic" });
}

/** 解析 YAML 中的三区 prompts 文档。layout 校验的 `Result` 失败沿返回值交给上层（错误通道迁移四期）。 */
export function loadAgentPromptLayoutFromYaml(source: string): Result<AgentPromptLayout, AppError> {
  let parsed: unknown;
  try {
    parsed = parseText(source, "yaml");
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid YAML";
    throw new AppError("PROMPT_INVALID_YAML", { detail: message });
  }

  const promptsRaw = extractPromptsRecord(parsed);
  const doc = decode(promptsRaw, promptsDocumentSchema);
  const layout = validateAgentPromptLayoutFromMaps(doc.persist, doc.dynamic, doc.system);
  if (!layout.ok) return layout;
  return Result.ok(layout.value);
}
