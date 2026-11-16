/**
 * CLI: 从 YAML 加载 {@link AgentPromptLayout}（--prompt-path 快捷方式）。
 *
 * @module config/load-agent-prompt-layout
 */

import { decode, parseText } from "@novel-master/core";
import { AppError, promptsDocumentSchema } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { validateAgentPromptLayoutFromMaps, type AgentPromptLayout } from "@novel-master/core/prompt";

function extractPromptsRecord(parsed: unknown): Result<Record<string, unknown>, AppError> {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "prompt root must be an object" }));
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.persist != null ||
    record.dynamic != null ||
    record.system != null
  ) {
    return Result.ok(record);
  }
  const nested = record.prompts;
  if (nested != null && typeof nested === "object" && !Array.isArray(nested)) {
    return Result.ok(nested as Record<string, unknown>);
  }
  return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "prompt root must contain prompts.system / persist / dynamic" }));
}

/** 解析 YAML 中的三区 prompts 文档。layout 校验的 `Result` 失败沿返回值交给上层（错误通道迁移四期）。 */
export function loadAgentPromptLayoutFromYaml(source: string): Result<AgentPromptLayout, AppError> {
  const parsed = parseText(source, "yaml");
  if (!parsed.ok) {
    // 原形态把 parseText 的 CONFIG_DECODE_INVALID_SCHEMA 转包成 PROMPT_INVALID_YAML（detail 透传），保留码语义。
    return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: parsed.error.message }));
  }

  const promptsRaw = extractPromptsRecord(parsed.value);
  if (!promptsRaw.ok) return Result.err(promptsRaw.error);
  const doc = decode(promptsRaw.value, promptsDocumentSchema);
  if (!doc.ok) return Result.err(doc.error);
  const layout = validateAgentPromptLayoutFromMaps(doc.value.persist, doc.value.dynamic, doc.value.system);
  if (!layout.ok) return layout;
  return Result.ok(layout.value);
}
