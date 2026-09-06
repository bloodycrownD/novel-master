/**
 * Human-readable tool output for LLM history and prompt preview.
 *
 * @module domain/tool/logic/format-tool-output
 */

import { formatVfsErrorForLlm } from "@/domain/vfs/logic/format-vfs-error-for-llm.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { ToolError } from "@/errors/tool-errors.js";
import { VfsError, isVfsError } from "@/errors/vfs-errors.js";
import { TdbcError } from "@/infra/tdbc/index.js";
import type { ZodIssue } from "zod";

export type FormatToolErrorForLlmOptions = {
  readonly vfsScope?: VfsScope;
};

type GrepMatchShape = {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
};

function formatLineNumber(lineNum: number): string {
  return String(lineNum).padStart(6, " ");
}

/** Detects read tool output (including truncated). */
export function isReadOutput(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.path === "string" &&
    typeof rec.content === "string" &&
    typeof rec.totalLines === "number" &&
    typeof rec.returnedLines === "number" &&
    typeof rec.truncated === "boolean"
  );
}

/** Formats read output with 6-digit right-aligned line numbers. */
export function formatReadOutput(rec: Record<string, unknown>): string {
  const content = rec.content as string;
  const offset = typeof rec.offset === "number" ? rec.offset : 1;
  const lines = content.split("\n");
  const numbered = lines.map(
    (line, index) => `${formatLineNumber(offset + index)}|${line}`
  );
  const parts = [numbered.join("\n")];

  if (rec.truncated === true) {
    const hints: string[] = ["Output truncated."];
    if (rec.lastLineTruncated === true) {
      hints.push(
        "Last line was cut at the 50KB byte budget; its tail is not resumable (continue from the next line)."
      );
    }
    if (typeof rec.totalLines === "number") {
      hints.push(`Total lines: ${rec.totalLines}.`);
    }
    if (typeof rec.nextOffset === "number") {
      hints.push(`Continue with offset=${rec.nextOffset}.`);
    }
    parts.push(hints.join(" "));
  }

  return parts.join("\n\n");
}

/** Detects vfs grep tool output (excludes chat_grep). */
export function isGrepOutput(rec: Record<string, unknown>): boolean {
  if (
    !Array.isArray(rec.matches) ||
    typeof rec.total !== "number" ||
    typeof rec.truncated !== "boolean"
  ) {
    return false;
  }

  if (rec.matches.length === 0) {
    return !Array.isArray(rec.paths) && !Array.isArray(rec.entries);
  }

  const first = rec.matches[0];
  if (first == null || typeof first !== "object") {
    return false;
  }

  const match = first as Record<string, unknown>;
  if ("messageId" in match || "seq" in match || "hidden" in match) {
    return false;
  }

  return (
    typeof match.path === "string" &&
    typeof match.line === "number" &&
    typeof match.column === "number" &&
    typeof match.excerpt === "string"
  );
}

/** Formats grep matches as `path:line:column: excerpt` per line. */
export function formatGrepOutput(rec: Record<string, unknown>): string {
  const matches = rec.matches as readonly GrepMatchShape[];
  let out = matches
    .map(
      (match) => `${match.path}:${match.line}:${match.column}: ${match.excerpt}`
    )
    .join("\n");

  if (rec.truncated === true) {
    const omitted =
      typeof rec.total === "number" ? rec.total - matches.length : undefined;
    const hint =
      omitted != null && omitted > 0
        ? `\n\nOutput truncated (${omitted} more omitted; total ${rec.total}).`
        : `\n\nOutput truncated (total ${rec.total}).`;
    out += hint;
  }

  return out;
}

/** Detects glob tool output. */
export function isGlobOutput(rec: Record<string, unknown>): boolean {
  return (
    Array.isArray(rec.paths) &&
    typeof rec.total === "number" &&
    typeof rec.truncated === "boolean" &&
    !Array.isArray(rec.entries) &&
    !Array.isArray(rec.matches)
  );
}

/** Formats glob paths one per line. */
export function formatGlobOutput(rec: Record<string, unknown>): string {
  const paths = rec.paths as readonly string[];
  let out = paths.join("\n");

  if (rec.truncated === true) {
    const omitted =
      typeof rec.total === "number" ? rec.total - paths.length : undefined;
    const hint =
      omitted != null && omitted > 0
        ? `\n\nOutput truncated (${omitted} more omitted; total ${rec.total}).`
        : `\n\nOutput truncated (total ${rec.total}).`;
    out += hint;
  }

  return out;
}

function isFsLsOutput(rec: Record<string, unknown>): boolean {
  return Array.isArray(rec.entries) && typeof rec.total === "number";
}

function formatFsLsOutput(rec: Record<string, unknown>): string {
  const entries = rec.entries as Array<{ path: string; kind: string }>;
  const lines = entries.map((e) => `${e.path}\t${e.kind}`);
  let out = lines.join("\n");
  if (rec.truncated === true) {
    const omitted =
      typeof rec.omitted === "number"
        ? rec.omitted
        : typeof rec.total === "number"
        ? rec.total - entries.length
        : 0;
    out += `\n\nOutput truncated (${omitted} entries omitted; total ${rec.total}).`;
  }
  return out;
}

/**
 * Detects search tool output（正常 results 形态 / 超预算落盘 savedPath 形态）。
 *
 * 正常形态：`engine` 字符串 + `results` 数组（空结果集也是正常形态；
 * 非空时首元素须具备 title/url/snippet 三字段）；落盘形态（overflow-sink
 * Step 6 接线后出现）：`savedPath` + `message` + `engine`。未配置提示
 * 是纯字符串输出，不经过本守卫（formatToolOutputForLlm 对 string 直通）。
 */
export function isSearchOutput(rec: Record<string, unknown>): boolean {
  if (typeof rec.engine !== "string") {
    return false;
  }
  // 落盘形态：正文已存 /tmp/，回 {savedPath, message}。
  if (
    typeof rec.savedPath === "string" &&
    typeof rec.message === "string"
  ) {
    return true;
  }
  if (!Array.isArray(rec.results)) {
    return false;
  }
  if (rec.results.length === 0) {
    return true;
  }
  const first = rec.results[0];
  if (first == null || typeof first !== "object") {
    return false;
  }
  const item = first as Record<string, unknown>;
  return (
    typeof item.title === "string" &&
    typeof item.url === "string" &&
    typeof item.snippet === "string"
  );
}

/**
 * Formats search output：引擎名 + 条数抬头，tavily 原生回答（如有）紧随，
 * 其后为「- 标题 — 链接 — 摘要」紧凑列表；落盘形态显示「已落盘路径」
 * （不落 JSON fallback）。
 */
export function formatSearchOutput(rec: Record<string, unknown>): string {
  if (typeof rec.savedPath === "string") {
    const message =
      typeof rec.message === "string" && rec.message.length > 0
        ? `\n${rec.message}`
        : "";
    return `已落盘 ${rec.savedPath}${message}`;
  }
  const engine = rec.engine as string;
  const results = rec.results as Array<{
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
  }>;
  const parts: string[] = [`search ${engine} · ${results.length} 条结果`];
  if (typeof rec.answer === "string" && rec.answer.length > 0) {
    parts.push("", rec.answer);
  }
  for (const item of results) {
    parts.push(`- ${item.title} — ${item.url} — ${item.snippet}`);
  }
  return parts.join("\n");
}

/**
 * Detects curl tool output.
 *
 * 守卫要求 url + finalUrl + status + body + truncated 同时类型匹配；
 * 现有工具输出均无 url 字段，不会误撞 read / grep / glob / fs 形状。
 * method 不入守卫（curl 升级前的历史输出无该字段，formatter 缺省 GET）。
 */
export function isCurlOutput(rec: Record<string, unknown>): boolean {
  return (
    typeof rec.url === "string" &&
    typeof rec.finalUrl === "string" &&
    typeof rec.status === "number" &&
    typeof rec.body === "string" &&
    typeof rec.truncated === "boolean"
  );
}

/**
 * Formats curl output as `curl <METHOD> <url> → <finalUrl>` + status header + body.
 *
 * method 从输出回显（缺省 GET）；超预算落盘形态（savedPath）空行后显示
 * 已落盘路径与说明（body 为空串占位）；降级截断的标注行由工具本体附
 * 在 body 末尾（不计入字节预算），这里不重复追加。
 */
export function formatCurlOutput(rec: Record<string, unknown>): string {
  const url = rec.url as string;
  const finalUrl = rec.finalUrl as string;
  const method =
    typeof rec.method === "string" && rec.method.length > 0
      ? (rec.method as string)
      : "GET";
  const contentType =
    typeof rec.contentType === "string" ? (rec.contentType as string) : "";
  const requestLine =
    finalUrl !== url
      ? `curl ${method} ${url} → ${finalUrl}`
      : `curl ${method} ${url}`;
  const statusLine =
    contentType.length > 0
      ? `Status: ${rec.status} · ${contentType}`
      : `Status: ${rec.status}`;
  if (typeof rec.savedPath === "string") {
    const message =
      typeof rec.message === "string" && rec.message.length > 0
        ? `\n${rec.message}`
        : "";
    return `${requestLine}\n${statusLine}\n\n已落盘 ${rec.savedPath}${message}`;
  }
  return `${requestLine}\n${statusLine}\n\n${rec.body}`;
}

/** Detects skill load tool output (content + files manifest). */
export function isSkillLoadOutput(rec: Record<string, unknown>): boolean {
  return (
    rec.action === "load" &&
    typeof rec.content === "string" &&
    typeof rec.version === "number"
  );
}

/**
 * Formats skill load as line-numbered content (read 同款) + 附属文件清单。
 *
 * alreadyReferenced 短提示（本请求已注入过全文）直接返回提示文本，
 * 不加行号；截断时提示续读走 skill read 的 offset/limit。
 */
export function formatSkillLoadOutput(rec: Record<string, unknown>): string {
  if (rec.alreadyReferenced === true) {
    return rec.content as string;
  }
  let out = formatReadOutput(rec);
  if (rec.truncated === true) {
    out += "\n续读请用 skill read 的 offset/limit。";
  }
  const files = Array.isArray(rec.files)
    ? rec.files.filter((f) => typeof f === "string")
    : [];
  if (files.length > 0) {
    out += `\n\n附属文件（相对技能目录）：${files.join("、")}`;
  }
  return out;
}

/**
 * Detects mutation-ack outputs（skill write/edit、agent create/update）。
 *
 * 这些动作的返回是保存回执（echo + version/agentId），对模型无后续决策
 * 价值：写入成功即 ok，与 vfs write/edit、fs 变更类的快速通道对齐。
 * 带 content 的输出（load/read 类）不会被误命中。
 */
function isMutationAckOutput(rec: Record<string, unknown>): boolean {
  if (typeof rec.action !== "string") {
    return false;
  }
  if (rec.action === "write" || rec.action === "edit") {
    return (
      typeof rec.version === "number" && typeof rec.content !== "string"
    );
  }
  if (rec.action === "create" || rec.action === "update") {
    return (
      typeof rec.name === "string" &&
      typeof rec.agentId === "string" &&
      typeof rec.content !== "string"
    );
  }
  return false;
}

/** Compact tool success text for the model (e.g. write → `ok`). */
export function formatToolOutputForLlm(out: unknown): string {
  if (typeof out === "string") {
    return out;
  }
  if (out != null && typeof out === "object" && !Array.isArray(out)) {
    const rec = out as Record<string, unknown>;
    const keys = Object.keys(rec);

    if (isReadOutput(rec)) {
      return formatReadOutput(rec);
    }

    if (isFsLsOutput(rec)) {
      return formatFsLsOutput(rec);
    }

    if (isGrepOutput(rec)) {
      return formatGrepOutput(rec);
    }

    if (isGlobOutput(rec)) {
      return formatGlobOutput(rec);
    }

    if (isSearchOutput(rec)) {
      return formatSearchOutput(rec);
    }

    if (isCurlOutput(rec)) {
      return formatCurlOutput(rec);
    }

    if (isSkillLoadOutput(rec)) {
      return formatSkillLoadOutput(rec);
    }

    if (isMutationAckOutput(rec)) {
      return "ok";
    }

    if (keys.length === 1 && typeof rec.version === "number") {
      return "ok";
    }
    if (
      keys.length === 2 &&
      typeof rec.version === "number" &&
      typeof rec.replacements === "number"
    ) {
      return "ok";
    }
    if (keys.length === 1 && rec.ok === true) {
      return "ok";
    }
  }
  return JSON.stringify(out, null, 2);
}

/**
 * Formats tool execution failures for LLM `tool_result` content.
 *
 * @remarks Unwraps {@link ToolError} `cause` (e.g. {@link VfsError}) so the model sees actionable detail.
 */
export function formatToolErrorForLlm(
  error: unknown,
  options?: FormatToolErrorForLlmOptions
): string {
  let message: string;
  if (error instanceof ToolError) {
    if (
      error.code === "INVALID_ARGUMENT" &&
      error.details != null &&
      "issues" in error.details
    ) {
      const issues = error.details.issues as readonly ZodIssue[];
      const summary = issues.map((i) => i.message).join("; ");
      message = summary.length > 0 ? summary : error.message;
    } else if (error.cause != null) {
      message = formatToolErrorCause(error.cause, options?.vfsScope);
    } else {
      message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  return `Error: ${message}`;
}

function resolveVfsErrorFromCause(cause: unknown): VfsError | undefined {
  if (cause instanceof TdbcError && cause.cause != null) {
    return resolveVfsErrorFromCause(cause.cause);
  }
  if (cause instanceof VfsError) {
    return cause;
  }
  if (isVfsError(cause)) {
    return cause as VfsError;
  }
  return undefined;
}

function formatToolErrorCause(cause: unknown, vfsScope?: VfsScope): string {
  const vfsError = resolveVfsErrorFromCause(cause);
  if (vfsError != null) {
    return formatVfsErrorForLlm(vfsError, vfsScope);
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/** Prettify stored tool_result bodies (legacy rows may still be JSON). */
export function formatToolResultContentForDisplay(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("Error:")) {
    return content;
  }
  try {
    return formatToolOutputForLlm(JSON.parse(trimmed) as unknown);
  } catch {
    return content;
  }
}
