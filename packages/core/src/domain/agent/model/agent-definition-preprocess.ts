/**
 * Agent definition wire 预处理：旧字段剥离与 removed-feature 拦截。
 *
 * @module domain/agent/model/agent-definition-preprocess
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { AgentPromptLayoutNormalize } from "@/domain/prompt/logic/normalize-agent-prompt-layout.js";

export const AgentDefinitionPreprocess = {
  /** 文本块 wire 值：剥 lifecycle 键（常驻开关下线后一律 once 语义）。 */
  stripLifecycleFromTextBlock(raw: unknown): unknown {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return raw;
    }
    const record = raw as Record<string, unknown>;
    if (!("lifecycle" in record)) {
      return raw;
    }
    const rest = { ...record };
    delete rest.lifecycle;
    return rest;
  },

  /** prompts 区 removed-feature 拦截 + persist 旧 worktree 块剥离。 */
  stripLegacyPrompts(raw: unknown): Result<unknown, AppError> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return Result.ok(raw);
    }
    const record = raw as Record<string, unknown>;
    if ("blocks" in record) {
      return Result.err(new AppError("AGENT_INVALID_SCHEMA", { detail: "prompts.blocks is removed; use prompts.system / persist / dynamic" }));
    }
    if ("regions" in record) {
      return Result.err(new AppError("AGENT_INVALID_SCHEMA", { detail: "prompts.regions is not supported; use prompts.system / persist / dynamic" }));
    }
    if ("chat" in record) {
      return Result.err(new AppError("AGENT_INVALID_SCHEMA", { detail: "prompts.chat is not supported; chat is a runtime slot only" }));
    }
    const persist = record.persist;
    if (persist == null || typeof persist !== "object" || Array.isArray(persist)) {
      return Result.ok(raw);
    }
    return Result.ok({ ...record, persist: AgentPromptLayoutNormalize.stripLegacyWorktreeBlocksFromPersistMap(persist as Record<string, unknown>) });
  },

  /** 根文档 wire 预处理：preferredModelId / legacy nested model 拦截。 */
  stripLegacyAgentWire(raw: unknown): Result<unknown, AppError> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      return Result.ok(raw);
    }
    const record = raw as Record<string, unknown>;
    if ("preferredModelId" in record) {
      return Result.err(new AppError("AGENT_INVALID_SCHEMA", { detail: "preferredModelId is removed; use optional model: <savedModelId UUID>" }));
    }
    const model = record.model;
    if (model != null && typeof model === "object" && !Array.isArray(model)) {
      return Result.err(new AppError("AGENT_INVALID_SCHEMA", { detail: "legacy nested model block is not supported" }));
    }
    // subagentCallable 已废弃且功能未发布，无旧数据需兼容：strict schema 直接拒绝。
    return Result.ok(raw);
  },
} as const;
