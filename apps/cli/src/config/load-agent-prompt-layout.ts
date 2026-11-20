/**
 * CLI: 从 YAML 加载 {@link AgentPromptLayout}（--prompt-path 快捷方式）。
 *
 * @module config/load-agent-prompt-layout
 */

import { decode, parseText } from "@novel-master/core";
import { AppError, promptsDocumentSchema } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import { validateAgentPromptLayoutFromMaps, type AgentPromptLayout } from "@novel-master/core/prompt";

/** 解析 YAML 中的三区 prompts 文档。layout 校验的 `Result` 失败沿返回值交给上层（错误通道迁移四期）。 */
export function loadAgentPromptLayoutFromYaml(source: string): Result<AgentPromptLayout, AppError> {
  const parsed = parseText(source, "yaml");
  if (!parsed.ok) {
    // 原形态把 parseText 的 CONFIG_DECODE_INVALID_SCHEMA 转包成 PROMPT_INVALID_YAML（detail 透传），保留码语义。
    return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: parsed.error.message }));
  }

  if (parsed.value == null || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "prompt root must be an object" }));
  }
  const record = parsed.value as Record<string, unknown>;
  let promptsRecord: Record<string, unknown>;
  if (record.persist != null || record.dynamic != null || record.system != null) {
    promptsRecord = record;
  } else {
    const nested = record.prompts;
    if (nested == null || typeof nested !== "object" || Array.isArray(nested)) {
      return Result.err(new AppError("PROMPT_INVALID_YAML", { detail: "prompt root must contain prompts.system / persist / dynamic" }));
    }
    promptsRecord = nested as Record<string, unknown>;
  }
  const doc = decode(promptsRecord, promptsDocumentSchema);
  if (!doc.ok) return Result.err(doc.error);
  const layout = validateAgentPromptLayoutFromMaps(doc.value.persist, doc.value.dynamic, doc.value.system);
  if (!layout.ok) return layout;
  return Result.ok(layout.value);
}
