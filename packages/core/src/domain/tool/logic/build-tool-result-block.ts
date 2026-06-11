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
import type { ParallelToolOutcome } from "./tool-runner.js";

export interface BuildToolResultBlockMeta {
  readonly toolName?: string;
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
    return {
      type: "tool_result",
      toolUseId,
      ok: true,
      content,
      ...(summary != null ? { summary } : {}),
    };
  }

  const content = formatToolErrorForLlm(outcome.error);
  const summary = summarizeToolError(content);
  return {
    type: "tool_result",
    toolUseId,
    ok: false,
    content,
    ...(summary != null ? { summary } : {}),
  };
}
