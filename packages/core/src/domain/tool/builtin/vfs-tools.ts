/**
 * Builtin workspace file tools backed by {@link VfsService}.
 *
 * @module domain/tool/builtin/vfs-tools
 */

import { z } from "zod";

import type { Tool } from "../model/tool.js";
import type {
  VfsGrepMatch,
  VfsReadResult,
  WriteOptions,
} from "@/domain/vfs/ports/vfs-service.port.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import {
  executeFsCommand,
  parseFsCommand,
  type FsCommandResult,
} from "../logic/fs-command.js";
import {
  capMatchList,
  capUtf8Bytes,
  sliceLinesFromOffset,
  TOOL_OUTPUT_MAX_LINES,
  TOOL_OUTPUT_MAX_MATCHES,
  truncateLine,
} from "../logic/tool-output-limits.js";
import { ToolError } from "@/errors/tool-errors.js";

/** Registered builtin file tool names (insertion order). */
export const FILE_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "fs",
  "glob",
  "grep",
] as const;

export type FileToolName = (typeof FILE_TOOL_NAMES)[number];

/** Tools that mutate session file content (checkpoint-eligible). */
export const MUTATING_FILE_TOOL_NAMES = new Set<FileToolName>([
  "write",
  "edit",
  "fs",
]);

/** @deprecated Use {@link MUTATING_FILE_TOOL_NAMES}. */
export const MUTATING_VFS_TOOL_NAMES = MUTATING_FILE_TOOL_NAMES;

/** Returns whether a tool name performs file mutations for checkpoint purposes. */
export function isMutatingFileToolName(name: string): boolean {
  return MUTATING_FILE_TOOL_NAMES.has(name as FileToolName);
}

/** @deprecated Use {@link isMutatingFileToolName}. */
export const isMutatingVfsToolName = isMutatingFileToolName;

/** Tools whose results can open a file in the workspace preview. */
export const FILE_OPEN_TOOL_NAMES = new Set<FileToolName>([
  "read",
  "write",
  "edit",
]);

/** Maps legacy agent policy `vfs.read` → `read`. */
export function normalizeAgentToolPolicyName(name: string): string {
  return name.startsWith("vfs.") ? name.slice(4) : name;
}

export type ReadToolOutput = {
  readonly path: string;
  readonly content: string;
  readonly version: number;
  readonly mtimeMs: number;
  readonly offset: number;
  readonly limit: number;
  readonly totalLines: number;
  readonly returnedLines: number;
  readonly truncated: boolean;
  readonly nextOffset?: number;
};

export type GrepToolOutput = {
  readonly matches: readonly VfsGrepMatch[];
  readonly total: number;
  readonly truncated: boolean;
};

export type GlobToolOutput = {
  readonly paths: readonly string[];
  readonly total: number;
  readonly truncated: boolean;
};

/**
 * Creates the builtin workspace file tools (V2: 6 tools).
 *
 * @remarks
 * Visibility and access rules come from the injected `VfsService` instance
 * (global / project / session scope). Mutations append revisions via the revision-aware wrapper.
 */
export function createVfsTools(): readonly Tool<any, any, BuiltinToolContext>[] {
  const read: Tool<
    { path: string; offset?: number; limit?: number },
    ReadToolOutput,
    BuiltinToolContext
  > = {
    name: "read",
    description: "读取工作区文件内容（支持 offset/limit 分页）",
    inputSchema: z.object({
      path: z.string().min(1),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).optional(),
    }),
    outputSchema: z.object({
      path: z.string(),
      content: z.string(),
      version: z.number().int(),
      mtimeMs: z.number(),
      offset: z.number().int(),
      limit: z.number().int(),
      totalLines: z.number().int(),
      returnedLines: z.number().int(),
      truncated: z.boolean(),
      nextOffset: z.number().int().optional(),
    }),
    async run(input, ctx) {
      const offset = input.offset ?? 1;
      const limit = input.limit ?? TOOL_OUTPUT_MAX_LINES;
      const raw = await ctx.vfs.read(input.path);
      const lines = raw.content.split("\n");
      const totalLines = lines.length;

      if (offset > 1 && totalLines === 0) {
        throw new ToolError(
          "INVALID_ARGUMENT",
          `offset ${offset} exceeds file length (0 lines)`,
          { toolName: "read" },
        );
      }
      if (totalLines > 0 && offset > totalLines) {
        throw new ToolError(
          "INVALID_ARGUMENT",
          `offset ${offset} exceeds file length (${totalLines} lines)`,
          { toolName: "read" },
        );
      }

      const { slice, nextOffset: lineNextOffset } = sliceLinesFromOffset(
        lines,
        offset,
        limit,
      );
      const truncatedLines = slice.map((line) => truncateLine(line).line);
      const byteCapped = capUtf8Bytes(truncatedLines);
      const content = byteCapped.lines.join("\n");
      const returnedLines = byteCapped.lines.length;
      const truncated =
        byteCapped.truncated ||
        returnedLines < slice.length ||
        (lineNextOffset != null && returnedLines >= limit);

      let nextOffset: number | undefined;
      if (truncated) {
        if (byteCapped.truncated && returnedLines > 0) {
          nextOffset = offset + returnedLines;
        } else if (lineNextOffset != null) {
          nextOffset = lineNextOffset;
        }
      }

      return {
        path: raw.path,
        content,
        version: raw.version,
        mtimeMs: raw.mtimeMs,
        offset,
        limit,
        totalLines,
        returnedLines,
        truncated,
        ...(nextOffset != null ? { nextOffset } : {}),
      };
    },
  };

  const write: Tool<
    { path: string; content: string; options?: WriteOptions },
    { version: number },
    BuiltinToolContext
  > = {
    name: "write",
    description: "写入或覆盖工作区文件（可选版本校验）",
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      options: z
        .object({
          expectedVersion: z.number().int().optional(),
          versionCheck: z.boolean().optional(),
        })
        .optional(),
    }),
    outputSchema: z.object({ version: z.number().int() }),
    async run(input, ctx) {
      const versionCheck = input.options?.versionCheck ?? false;
      return await ctx.vfs.write(input.path, input.content, {
        versionCheck,
        ...(input.options?.expectedVersion != null
          ? { expectedVersion: input.options.expectedVersion }
          : {}),
      });
    },
  };

  const edit: Tool<
    {
      path: string;
      oldString: string;
      newString: string;
      options?: { replaceAll?: boolean };
    },
    { version: number; replacements: number },
    BuiltinToolContext
  > = {
    name: "edit",
    description: "在工作区文件内查找并替换文本",
    inputSchema: z.object({
      path: z.string().min(1),
      oldString: z.string(),
      newString: z.string(),
      options: z.object({ replaceAll: z.boolean().optional() }).optional(),
    }),
    outputSchema: z.object({
      version: z.number().int(),
      replacements: z.number().int(),
    }),
    async run(input, ctx) {
      return await ctx.vfs.replace(
        input.path,
        input.oldString,
        input.newString,
        input.options,
      );
    },
  };

  const fs: Tool<{ command: string }, FsCommandResult, BuiltinToolContext> = {
    name: "fs",
    description:
      "执行单条文件系统命令（ls、rm、mv、cp、mkdir、rmdir）；不支持 shell 链式语法",
    inputSchema: z.object({ command: z.string().min(1) }),
    outputSchema: z.union([
      z.object({ ok: z.literal(true) }),
      z.object({
        entries: z.array(
          z.object({
            path: z.string(),
            kind: z.enum(["file", "directory"]),
          }),
        ),
        total: z.number().int(),
        truncated: z.boolean(),
        omitted: z.number().int().optional(),
      }),
    ]),
    async run(input, ctx) {
      const parsed = parseFsCommand(input.command);
      return await executeFsCommand(ctx.vfs, parsed);
    },
  };

  const glob: Tool<
    { pattern: string; options?: { cwd?: string } },
    GlobToolOutput,
    BuiltinToolContext
  > = {
    name: "glob",
    description: "按 glob 模式在工作区中查找路径",
    inputSchema: z.object({
      pattern: z.string().min(1),
      options: z.object({ cwd: z.string().optional() }).optional(),
    }),
    outputSchema: z.object({
      paths: z.array(z.string()),
      total: z.number().int(),
      truncated: z.boolean(),
    }),
    async run(input, ctx) {
      const allPaths = await ctx.vfs.glob(input.pattern, input.options);
      const capped = capMatchList(allPaths, TOOL_OUTPUT_MAX_MATCHES, (p) => p);
      return {
        paths: capped.items,
        total: capped.total,
        truncated: capped.truncated,
      };
    },
  };

  const grep: Tool<
    { pattern: string; options?: { pathPrefix?: string } },
    GrepToolOutput,
    BuiltinToolContext
  > = {
    name: "grep",
    description: "在工作区文件中搜索文本或正则",
    inputSchema: z.object({
      pattern: z.string().min(1),
      options: z.object({ pathPrefix: z.string().optional() }).optional(),
    }),
    outputSchema: z.object({
      matches: z.array(
        z.object({
          path: z.string(),
          line: z.number().int(),
          column: z.number().int(),
          excerpt: z.string(),
        }),
      ),
      total: z.number().int(),
      truncated: z.boolean(),
    }),
    async run(input, ctx) {
      const rawMatches = await ctx.vfs.grep(input.pattern, input.options);
      const withTruncatedExcerpts = rawMatches.map((m) => ({
        ...m,
        excerpt: truncateLine(m.excerpt).line,
      }));
      const capped = capMatchList(
        withTruncatedExcerpts,
        TOOL_OUTPUT_MAX_MATCHES,
        (m) => JSON.stringify(m),
      );
      return {
        matches: capped.items,
        total: capped.total,
        truncated: capped.truncated,
      };
    },
  };

  return [read, write, edit, fs, glob, grep];
}

export type { VfsReadResult };
export type { BuiltinToolContext } from "./builtin-tool-context.js";
/** @deprecated Use {@link BuiltinToolContext}. */
export type { VfsToolContext } from "./builtin-tool-context.js";
