/**
 * Human-readable tool output for LLM history and prompt preview.
 *
 * @remarks
 * `formatToolOutputForLlm` 的 read / skill load 输出自 v1.5.30 起**不再是冻结契约**。
 * v1.5.29 曾把它们标为「冻结、演进需版本化」，原因是读/skill tool_result
 * 改存引用块、wire 需按冻结 formatter 逐字节重放还原；unref 回迁后写侧恒存
 * 这些函数的产物本身（全文直出），仓内不再有任何重放方，wire 就是这份输
 * 出本身。因此可随需求自由调整格式，无需版本化。
 *
 * @module domain/tool/logic/format-tool-output
 */

import { formatVfsErrorForLlm } from "@/domain/vfs/logic/format-vfs-error-for-llm.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { isAppError } from "@/errors/app-error.js";
import { ToolError } from "@/errors/tool-errors.js";
import { VfsError, isVfsError } from "@/errors/vfs-errors.js";
import { TdbcError } from "@/infra/tdbc/index.js";
import type { ZodIssue } from "zod";

type FormatToolErrorForLlmOptions = {
  readonly vfsScope?: VfsScope;
};

type GrepMatchShape = {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
};

type SearchResultShape = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
};

/** Detects read tool output (including truncated). */
// nm-style: keep-public — 测试文件直接 import 本组守卫锁输出形态（本片禁改测试），保留为守卫契约。
export function isReadOutput(rec: Record<string, unknown>): boolean {
  return typeof rec.path === "string" && typeof rec.content === "string" && typeof rec.totalLines === "number" && typeof rec.returnedLines === "number" && typeof rec.truncated === "boolean";
}

/** Formats read output with 6-digit right-aligned line numbers. */
function formatReadOutput(rec: Record<string, unknown>): string {
  const content = rec.content as string;
  const offset = typeof rec.offset === "number" ? rec.offset : 1;
  const lines = content.split("\n");
  const numbered = lines.map((line, index) => `${String(offset + index).padStart(6, " ")}|${line}`);
  const parts = [numbered.join("\n")];

  if (rec.truncated === true) {
    const hints: string[] = ["Output truncated."];
    if (rec.lastLineTruncated === true) {
      hints.push("Last line was cut at the 50KB byte budget; its tail is not resumable (continue from the next line).");
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
// nm-style: keep-public — 测试文件直接 import 本组守卫锁输出形态（本片禁改测试），保留为守卫契约。
export function isGrepOutput(rec: Record<string, unknown>): boolean {
  if (!Array.isArray(rec.matches) || typeof rec.total !== "number" || typeof rec.truncated !== "boolean") {
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

  return typeof match.path === "string" && typeof match.line === "number" && typeof match.column === "number" && typeof match.excerpt === "string";
}

/** Detects glob tool output. */
// nm-style: keep-public — 测试文件直接 import 本组守卫锁输出形态（本片禁改测试），保留为守卫契约。
export function isGlobOutput(rec: Record<string, unknown>): boolean {
  return Array.isArray(rec.paths) && typeof rec.total === "number" && typeof rec.truncated === "boolean" && !Array.isArray(rec.entries) && !Array.isArray(rec.matches);
}

/**
 * Detects search tool output（正常 results 形态 / 超预算落盘 savedPath 形态）。
 *
 * 正常形态：`engine` 字符串 + `results` 数组（空结果集也是正常形态；
 * 非空时首元素须具备 title/url/snippet 三字段）或 `results` 字符串
 * （模板引擎透传形态：提取结果的 JSON 文本，attempts 仍可叠加）；
 * 落盘形态（overflow-sink Step 6 接线后出现）：`savedPath` + `message` +
 * `engine`。未配置提示是纯字符串输出，不经过本守卫
 * （formatToolOutputForLlm 对 string 直通）。
 */
// nm-style: keep-public — 测试文件直接 import 本组守卫锁输出形态（本片禁改测试），保留为守卫契约。
export function isSearchOutput(rec: Record<string, unknown>): boolean {
  if (typeof rec.engine !== "string") {
    return false;
  }
  // 落盘形态：正文已存 /tmp/，回 {savedPath, message}。
  if (typeof rec.savedPath === "string" && typeof rec.message === "string") {
    return true;
  }
  // 模板引擎透传形态：results 为提取结果的 JSON 文本。
  if (typeof rec.results === "string") {
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
  return typeof item.title === "string" && typeof item.url === "string" && typeof item.snippet === "string";
}

/**
 * Detects curl tool output.
 *
 * 守卫要求 url + finalUrl + status + body + truncated 同时类型匹配；
 * 现有工具输出均无 url 字段，不会误撞 read / grep / glob / fs 形状。
 * method 不入守卫（curl 升级前的历史输出无该字段，formatter 缺省 GET）。
 */
// nm-style: keep-public — 测试文件直接 import 本组守卫锁输出形态（本片禁改测试），保留为守卫契约。
export function isCurlOutput(rec: Record<string, unknown>): boolean {
  return typeof rec.url === "string" && typeof rec.finalUrl === "string" && typeof rec.status === "number" && typeof rec.body === "string" && typeof rec.truncated === "boolean";
}

/**
 * Compact tool success text for the model (e.g. write → `ok`).
 *
 * 守卫顺序即分派顺序：read → entries 列表（fs ls / skill list / agent list）→
 * grep → glob → search → curl → skill load → mutation 回执 → 泛化 version 形态。
 */
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

    // fs ls / skill list / agent list 共用的 entries+total 形态：条目字段自适应。
    // （历史教训：按 fs 字段硬拼会把 name/description 条目拼成字面 undefined 进 tool_result 落库。）
    if (Array.isArray(rec.entries) && typeof rec.total === "number") {
      const entries = rec.entries as Array<Record<string, unknown>>;
      const lines = entries.map((entry) => {
        if (typeof entry.path === "string") {
          return typeof entry.kind === "string" ? `${entry.path}\t${entry.kind}` : entry.path;
        }
        const name = typeof entry.name === "string" && entry.name !== "" ? entry.name : "(未命名)";
        const description = typeof entry.description === "string" ? entry.description.trim() : "";
        return description !== "" ? `${name}\t${description}` : name;
      });
      let out = lines.join("\n");
      if (rec.truncated === true) {
        const omitted = typeof rec.omitted === "number" ? rec.omitted : typeof rec.total === "number" ? rec.total - entries.length : 0;
        out += `\n\nOutput truncated (${omitted} entries omitted; total ${rec.total}).`;
      }
      return out;
    }

    if (isGrepOutput(rec)) {
      const matches = rec.matches as readonly GrepMatchShape[];
      let out = matches.map((match) => `${match.path}:${match.line}:${match.column}: ${match.excerpt}`).join("\n");
      if (rec.truncated === true) {
        const omitted = typeof rec.total === "number" ? rec.total - matches.length : undefined;
        const hint = omitted != null && omitted > 0 ? `\n\nOutput truncated (${omitted} more omitted; total ${rec.total}).` : `\n\nOutput truncated (total ${rec.total}).`;
        out += hint;
      }
      return out;
    }

    if (isGlobOutput(rec)) {
      const paths = rec.paths as readonly string[];
      let out = paths.join("\n");
      if (rec.truncated === true) {
        const omitted = typeof rec.total === "number" ? rec.total - paths.length : undefined;
        const hint = omitted != null && omitted > 0 ? `\n\nOutput truncated (${omitted} more omitted; total ${rec.total}).` : `\n\nOutput truncated (total ${rec.total}).`;
        out += hint;
      }
      return out;
    }

    if (isSearchOutput(rec)) {
      // 落盘形态显示「已落盘路径」；正常形态是「引擎名 + 条数抬头」，
      // 串行降级时下一行展示尝试轨迹，tavily 原生回答紧随其后。
      if (typeof rec.savedPath === "string") {
        const message = typeof rec.message === "string" && rec.message.length > 0 ? `\n${rec.message}` : "";
        return `已落盘 ${rec.savedPath}${message}`;
      }
      const engine = rec.engine as string;
      // 模板引擎透传形态：results 是提取结果的 JSON 文本，原样文本块输出
      // （截断由上游预算负责：模板侧 50KB 内截断 + 工具层整体序列化落盘保险丝）。
      if (typeof rec.results === "string") {
        const parts: string[] = [`search ${engine} · 响应文本`];
        if (typeof rec.attempts === "string" && rec.attempts.length > 0) {
          parts.push(`尝试轨迹: ${rec.attempts}`);
        }
        parts.push(rec.results);
        return parts.join("\n");
      }
      const results = rec.results as ReadonlyArray<SearchResultShape>;
      const parts: string[] = [`search ${engine} · ${results.length} 条结果`];
      if (typeof rec.attempts === "string" && rec.attempts.length > 0) {
        parts.push(`尝试轨迹: ${rec.attempts}`);
      }
      if (typeof rec.answer === "string" && rec.answer.length > 0) {
        parts.push("", rec.answer);
      }
      for (const item of results) {
        parts.push(`- ${item.title} — ${item.url} — ${item.snippet}`);
      }
      return parts.join("\n");
    }

    if (isCurlOutput(rec)) {
      const url = rec.url as string;
      const finalUrl = rec.finalUrl as string;
      const method = typeof rec.method === "string" && rec.method.length > 0 ? (rec.method as string) : "GET";
      const contentType = typeof rec.contentType === "string" ? (rec.contentType as string) : "";
      const requestLine = finalUrl !== url ? `curl ${method} ${url} → ${finalUrl}` : `curl ${method} ${url}`;
      const statusLine = contentType.length > 0 ? `Status: ${rec.status} · ${contentType}` : `Status: ${rec.status}`;
      // 超预算落盘形态（savedPath）空行后显示已落盘路径与说明（body 为空串占位）；
      // 降级截断的标注行由工具本体附在 body 末尾，这里不重复追加。
      if (typeof rec.savedPath === "string") {
        const message = typeof rec.message === "string" && rec.message.length > 0 ? `\n${rec.message}` : "";
        return `${requestLine}\n${statusLine}\n\n已落盘 ${rec.savedPath}${message}`;
      }
      return `${requestLine}\n${statusLine}\n\n${rec.body}`;
    }

    // skill load：read 同款行号 + 附属文件清单；alreadyReferenced 短提示
    // （本请求已注入过全文）直接返回提示文本，不加行号；截断时提示续读走
    // skill read 的 offset/limit。
    if (rec.action === "load" && typeof rec.content === "string" && typeof rec.version === "number") {
      if (rec.alreadyReferenced === true) {
        return rec.content as string;
      }
      let out = formatReadOutput(rec);
      if (rec.truncated === true) {
        out += "\n续读请用 skill read 的 offset/limit。";
      }
      const files = Array.isArray(rec.files) ? rec.files.filter((f) => typeof f === "string") : [];
      if (files.length > 0) {
        out += `\n\n附属文件（相对技能目录）：${files.join("、")}`;
      }
      return out;
    }

    // mutation-ack（skill write/edit、agent create/update）：保存回执对模型无
    // 后续决策价值，写入成功即 ok，与 vfs write/edit、fs 变更类的快速通道对齐。
    // 带 content 的输出（load/read 类）不会被误命中。
    const action = rec.action;
    const isSkillMutationAck = (action === "write" || action === "edit") && typeof rec.version === "number" && typeof rec.content !== "string";
    const isAgentMutationAck = (action === "create" || action === "update") && typeof rec.name === "string" && typeof rec.agentId === "string" && typeof rec.content !== "string";
    if (isSkillMutationAck || isAgentMutationAck) {
      return "ok";
    }

    if (keys.length === 1 && typeof rec.version === "number") {
      return "ok";
    }
    if (keys.length === 2 && typeof rec.version === "number" && typeof rec.replacements === "number") {
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
// nm-style: keep-public — 两个测试文件直接 import（本片禁改测试）；且是 tool_result 错误文案的统一出口，内联进 buildToolResultBlock 会把 13 处测试锁定的格式搬进另一模块。
export function formatToolErrorForLlm(error: unknown, options?: FormatToolErrorForLlmOptions): string {
  let message: string;
  if (error instanceof ToolError) {
    if (error.code === "INVALID_ARGUMENT" && error.details != null && "issues" in error.details) {
      const issues = error.details.issues as readonly ZodIssue[];
      const summary = issues.map((i) => i.message).join("; ");
      message = summary.length > 0 ? summary : error.message;
    } else if (error.cause != null) {
      // TdbcError 可能层层包裹 VFS 失败：先剥到最内层 cause 找 VFS 分类；
      // 找不到时仍按**外层** cause 归类（AppError → VFS 文案，裸 Error → message）。
      let unwrapped: unknown = error.cause;
      while (unwrapped instanceof TdbcError && unwrapped.cause != null) {
        unwrapped = unwrapped.cause;
      }
      const vfsError = unwrapped instanceof VfsError ? unwrapped : isVfsError(unwrapped) ? unwrapped : undefined;
      const cause = error.cause;
      if (vfsError != null) {
        message = formatVfsErrorForLlm(vfsError, options?.vfsScope);
      } else if (isAppError(cause)) {
        message = formatVfsErrorForLlm(cause, options?.vfsScope);
      } else {
        message = cause instanceof Error ? cause.message : String(cause);
      }
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
