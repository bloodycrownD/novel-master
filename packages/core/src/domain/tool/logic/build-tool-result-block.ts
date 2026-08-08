/**
 * Assembles persisted {@link ToolResultBlock} from runner outcomes.
 *
 * @remarks
 * - `content` is LLM-facing text only (adapters ignore `ok` / `summary`).
 * - UI should use {@link resolveToolResultOk} instead of scanning `content`.
 *
 * @module domain/tool/logic/build-tool-result-block
 */

import type { ToolResultBlock } from "@/domain/chat/model/content-block.js";
import {
  formatToolErrorForLlm,
  formatToolOutputForLlm,
} from "./format-tool-output.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { ParallelToolOutcome } from "./tool-runner.js";

export interface BuildToolResultBlockMeta {
  readonly toolName?: string;
  readonly vfsScope?: VfsScope;
  /**
   * `task` 工具输出中的 `subagentSessionId`，透传到 `ToolResultBlock.meta.subagentSessionId`。
   *
   * 调用方可从 `outcome.output.subagentSessionId` 或独立源头传入；任一来源均为 string 时生效。
   */
  readonly subagentSessionId?: string;
}

/** UI / legacy: explicit `ok` wins; otherwise infer from `Error:` prefix only. */
export function resolveToolResultOk(block: ToolResultBlock): boolean {
  if (block.ok === false) {
    return false;
  }
  if (block.ok === true) {
    return true;
  }
  return !block.content.trimStart().startsWith("Error:");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeToolSuccess(
  toolName: string | undefined,
  output: unknown,
): string | undefined {
  if (!isRecord(output)) {
    return undefined;
  }
  const name = toolName ?? "";

  if (name === "read") {
    const returned = output.returnedLines;
    const total = output.totalLines;
    if (typeof returned === "number" && typeof total === "number") {
      if (output.truncated === true) {
        return `truncated · ${returned}/${total} lines`;
      }
      return `${returned} lines`;
    }
  }

  if (name === "edit") {
    const replacements = output.replacements;
    if (typeof replacements === "number") {
      return replacements === 1 ? "ok" : `${replacements} replacements`;
    }
  }

  if (name === "write" || output.ok === true) {
    if (typeof output.version === "number" || output.ok === true) {
      return "ok";
    }
  }

  if (name === "fs" && Array.isArray(output.entries)) {
    const count = output.entries.length;
    const total = typeof output.total === "number" ? output.total : count;
    if (output.truncated === true) {
      return `${count}/${total} entries`;
    }
    return `${count} entries`;
  }

  const matchItems = output.matches ?? output.paths;
  if (Array.isArray(matchItems) && typeof output.total === "number") {
    const n = matchItems.length;
    const label = name === "glob" ? "paths" : "matches";
    if (output.truncated === true) {
      return `${n}/${output.total} ${label}`;
    }
    return `${n} ${label}`;
  }

  return undefined;
}

function summarizeToolError(content: string): string | undefined {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("Error:")) {
    return undefined;
  }
  const msg = trimmed.slice("Error:".length).trimStart();
  return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
}

/**
 * Maps one parallel tool outcome to a block ready for session persistence.
 */
export function buildToolResultBlock(
  toolUseId: string,
  outcome: ParallelToolOutcome,
  meta?: BuildToolResultBlockMeta,
): ToolResultBlock {
  if (outcome.ok) {
    const content = formatToolOutputForLlm(outcome.output);
    const summary = summarizeToolSuccess(meta?.toolName, outcome.output);
    // task 工具输出对象形如 { text, subagentSessionId }：透传 subagentSessionId 到 meta。
    const subagentSessionId = resolveSubagentSessionIdFromOutcome(
      outcome.output,
      meta?.subagentSessionId,
    );

    // 中断回流（phase-1-abort-reflow）：outcome.ok=true 但 output.stopped=true 表示
    // 子 agent 被用户中断。tool-result 要标 ok=false（主 agent 区分「用户停止」与「崩溃」），
    // content 仍是 output.text（末条 assistant 文本或占位文案），meta 额外带 failureReason。
    if (isStoppedTaskOutput(outcome.output)) {
      const failureReason = readFailureReason(outcome.output);
      return {
        type: "tool_result",
        toolUseId,
        ok: false,
        content,
        ...(subagentSessionId != null
          ? {
              meta: {
                ...(failureReason != null ? { failureReason } : {}),
                subagentSessionId,
              },
            }
          : failureReason != null
            ? { meta: { failureReason } }
            : {}),
      };
    }

    return {
      type: "tool_result",
      toolUseId,
      ok: true,
      content,
      ...(summary != null ? { summary } : {}),
      ...(subagentSessionId != null
        ? { meta: { subagentSessionId } }
        : {}),
    };
  }

  const content = formatToolErrorForLlm(outcome.error, {
    vfsScope: meta?.vfsScope,
  });
  const summary = summarizeToolError(content);
  return {
    type: "tool_result",
    toolUseId,
    ok: false,
    content,
    ...(summary != null ? { summary } : {}),
  };
}

/**
 * 检测 task 工具输出是否携带有「用户停止」标记（phase-1-abort-reflow）。
 *
 * outcome.ok=true 但 output.stopped=true 时，buildToolResultBlock 要把这条
 * tool_result 标成 ok=false。本函数只做窄义类型守卫，不复用 resolveSubagentSessionIdFromOutcome
 * 的 object 判定，语义上更直结。
 */
function isStoppedTaskOutput(output: unknown): boolean {
  return (
    output != null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    (output as { stopped?: unknown }).stopped === true
  );
}

/** 从 task 工具输出读取 failureReason（仅 string 时生效，否则返回 undefined）。 */
function readFailureReason(output: unknown): string | undefined {
  if (
    output == null ||
    typeof output !== "object" ||
    Array.isArray(output)
  ) {
    return undefined;
  }
  const reason = (output as { failureReason?: unknown }).failureReason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * 从工具输出对象或显式 meta 提取 `subagentSessionId`。
 *
 * 优先 `outcome.output.subagentSessionId`（string 时生效）；否则回落到调用方显式传入的 meta。
 * 仅 task 工具有该字段，其他工具输出不含 subagentSessionId，返回 undefined。
 */
function resolveSubagentSessionIdFromOutcome(
  output: unknown,
  fallback?: string,
): string | undefined {
  if (
    output != null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as { subagentSessionId?: unknown }).subagentSessionId ===
      "string"
  ) {
    return (output as { subagentSessionId: string }).subagentSessionId;
  }
  return typeof fallback === "string" && fallback.length > 0
    ? fallback
    : undefined;
}
