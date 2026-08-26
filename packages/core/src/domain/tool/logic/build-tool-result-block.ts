/**
 * Assembles persisted {@link ToolResultBlock} from runner outcomes.
 *
 * @remarks
 * - `content` is LLM-facing text only (adapters ignore `ok` / `summary`).
 * - UI should use {@link resolveToolResultOk} instead of scanning `content`.
 *
 * @module domain/tool/logic/build-tool-result-block
 */

import type {
  SkillToolRef,
  ToolResultBlock,
} from "@/domain/chat/model/content-block.js";
import { resolveSkillToolRefFromOutput } from "@/domain/chat/logic/skill-tool-ref.js";
import {
  formatToolErrorForLlm,
  formatToolOutputForLlm,
} from "./format-tool-output.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { ParallelToolOutcome } from "./tool-runner.js";
import { FETCH_MAX_BODY_BYTES } from "../builtin/fetch-tool.js";

export interface BuildToolResultBlockMeta {
  readonly toolName?: string;
  readonly vfsScope?: VfsScope;
  /**
   * `task` 工具输出中的 `subagentSessionId`，透传到 `ToolResultBlock.meta.subagentSessionId`。
   *
   * 调用方可从 `outcome.output.subagentSessionId` 或独立源头传入；任一来源均为 string 时生效。
   */
  readonly subagentSessionId?: string;
  /**
   * `skill` project 域解析上下文（当前会话 projectId）。read 缺省域命中
   * 生效副本时输出只携带命中 domain/name，projectId 由这里补进 `meta.skillRef`。
   */
  readonly skillProjectId?: string;
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

/** 字节数格式化：1024 进位（B/KB/MB）、保留 1 位小数（整数位不带 .0）。 */
function formatByteSize(bytes: number): string {
  const trimFraction = (n: number): string => {
    const s = n.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimFraction(kb)}KB`;
  return `${trimFraction(kb / 1024)}MB`;
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

  // skill：按输出携带的 action 分发（load 域+文件数 / read 行数 / write 域+路径 /
  // edit 替换数 / list 条数）。必须在下方 generic matches/paths 分支之前——
  // list 输出的 entries+total 会撞上。
  if (name === "skill" && typeof output.action === "string") {
    if (output.action === "load") {
      const parts: string[] = [];
      if (typeof output.domain === "string" && typeof output.name === "string") {
        parts.push(`${output.domain}:${output.name}`);
      }
      if (output.alreadyReferenced === true) {
        parts.push("已在提示词中");
      } else if (Array.isArray(output.files)) {
        parts.push(`${output.files.length} files`);
      }
      if (parts.length > 0) return parts.join(" · ");
    }
    if (output.action === "read") {
      const returned = output.returnedLines;
      const total = output.totalLines;
      if (typeof returned === "number" && typeof total === "number") {
        if (output.truncated === true) {
          return `truncated · ${returned}/${total} lines`;
        }
        return `${returned} lines`;
      }
    }
    if (
      (output.action === "write" || output.action === "edit") &&
      typeof output.domain === "string" &&
      typeof output.name === "string" &&
      typeof output.path === "string"
    ) {
      if (output.action === "edit" && typeof output.replacements === "number") {
        return output.replacements === 1
          ? `${output.domain}:${output.name}/${output.path}`
          : `${output.replacements} replacements · ${output.domain}:${output.name}/${output.path}`;
      }
      return `${output.domain}:${output.name}/${output.path}`;
    }
    if (output.action === "list" && Array.isArray(output.entries)) {
      return `${output.entries.length} skills`;
    }
  }

  // agent：按输出 action 分发（list 条数 / get 定义名 / create+update 保存名）。
  // 与 skill 同理必须在下方 generic matches/paths 分支之前——list 输出的
  // entries+total 会撞上。
  if (name === "agent" && typeof output.action === "string") {
    if (output.action === "list" && Array.isArray(output.entries)) {
      const count = output.entries.length;
      const total = typeof output.total === "number" ? output.total : count;
      if (output.truncated === true) {
        return `${count}/${total} agents`;
      }
      return `${count} agents`;
    }
    if (output.action === "get") {
      const def = output.definition;
      if (isRecord(def) && typeof def.name === "string") {
        return def.name;
      }
    }
    if (
      (output.action === "create" || output.action === "update") &&
      typeof output.name === "string"
    ) {
      return `已保存 ${output.name}`;
    }
  }

  // fetch：状态 · 原始体积（如 `200 · 12.3KB`）；截断时保留量/原始量
  // （如 `truncated · 50KB/1.2MB`）。保留量即字节预算（截断的正文部分
  // ≤ FETCH_MAX_BODY_BYTES），非文本占位与预检占位很小，照 body 现算。
  if (name === "fetch") {
    const status = output.status;
    const originalBytes = output.originalBytes;
    if (typeof status === "number" && typeof originalBytes === "number") {
      if (output.truncated === true) {
        const bodyBytes =
          typeof output.body === "string"
            ? new TextEncoder().encode(output.body as string).byteLength
            : undefined;
        // 正常截断路径 body 含标注行会略超预算，展示上按预算值口径。
        const kept =
          bodyBytes != null && bodyBytes < FETCH_MAX_BODY_BYTES
            ? bodyBytes
            : FETCH_MAX_BODY_BYTES;
        return `truncated · ${formatByteSize(kept)}/${formatByteSize(originalBytes)}`;
      }
      return `${status} · ${formatByteSize(originalBytes)}`;
    }
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
    // skill 成功输出携带实际 domain/name（read 缺省域命中生效副本的解析结果
    // 也在这里）：照 subagentSessionId 自动检测透传到 meta.skillRef。
    const skillRef = resolveSkillToolRefFromOutcome(
      meta?.toolName,
      outcome.output,
      meta?.skillProjectId,
    );

    // 中断回流（phase-1-abort-reflow）：outcome.ok=true 但 output.stopped=true 表示
    // 子 agent 被用户中断。tool-result 要标 ok=false（主 agent 区分「用户停止」与「崩溃」），
    // content 是 task 输出的 JSON 壳（含 text + stopped + failureReason + subagentSessionId），
    // meta 额外带 failureReason（UI 卡片用）。
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
      ...(subagentSessionId != null || skillRef != null
        ? {
            meta: {
              ...(subagentSessionId != null ? { subagentSessionId } : {}),
              ...(skillRef != null ? { skillRef } : {}),
            },
          }
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

/**
 * 从 skill 成功输出提取跳转三元组（失败 outcome 一律 undefined）。
 *
 * 仅 `meta.toolName === "skill"` 时有意义；实际判定在
 * `resolveSkillToolRefFromOutput` 内（工具名 + 输出形态双门控）。
 */
function resolveSkillToolRefFromOutcome(
  toolName: string | undefined,
  output: unknown,
  skillProjectId?: string,
): SkillToolRef | undefined {
  if (toolName == null) return undefined;
  return resolveSkillToolRefFromOutput(toolName, output, skillProjectId);
}
