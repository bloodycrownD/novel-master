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
import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { serializeFileCachePayload } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";

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
    description: `读取工作区单个文件的文本内容。只读，不修改文件。

用法：
- 首次读取：提供 path；默认从第 1 行起返回一段内容
- 大文件续读：若返回 truncated=true，用 nextOffset 作为下次 offset 继续读
- 指定范围：offset 为起始行号（从 1 起），limit 为最多返回行数

与 write 区别：write 整文件覆盖；与 edit 区别：edit 做局部替换。需要先看清文件再改时，优先 read。`,
    inputSchema: z.object({
      path: z
        .string()
        .min(1)
        .describe("工作区内文件的绝对或相对路径"),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("起始行号（从 1 起）；省略则从第 1 行开始"),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("最多返回的行数；省略则使用默认上限"),
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
    description: `写入或整文件覆盖工作区路径的内容。会创建不存在的文件。

用法：
- 新建或全文重写：path + content

与 edit 区别：write 替换整个文件；小改动、局部替换请用 edit。与 read 配合：先 read 确认现状再 write。`,
    inputSchema: z.object({
      path: z
        .string()
        .min(1)
        .describe("目标文件路径；不存在则创建"),
      content: z.string().describe("写入后的完整文件内容（UTF-8 文本）"),
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
      const result = await ctx.vfs.write(input.path, input.content, {
        versionCheck,
        ...(input.options?.expectedVersion != null
          ? { expectedVersion: input.options.expectedVersion }
          : {}),
      });
      // 整文件 write 成功 → upsert file_cache full:{path}（edit 等不碰缓存）
      await upsertFileCacheAfterWrite(ctx, input.path, input.content);
      return result;
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
    description: `在工作区文件内做精确文本替换（单次或 replaceAll）。适合小范围修改，避免整文件 write。

用法：
- 常规替换：oldString 为文件中待替换片段，newString 为替换结果；oldString 须在文件中唯一匹配
- 尾追（追加）：以文件末尾一小段唯一文本为锚点，oldString=锚点，newString=锚点+要追加的新内容
- 全文替换：options.replaceAll=true 时替换所有匹配项

注意：默认要求 oldString 唯一；匹配 0 次或多于 1 次（且非 replaceAll）会报错。大段重写请用 write。`,
    inputSchema: z.object({
      path: z.string().min(1).describe("要修改的文件路径"),
      oldString: z
        .string()
        .describe(
          "要被替换的原文；须在文件中唯一定位（replaceAll 时除外）。尾追时取文件末尾唯一锚点",
        ),
      newString: z
        .string()
        .describe("替换后的文本；尾追时设为 oldString 与追加内容拼接"),
      options: z
        .object({
          replaceAll: z
            .boolean()
            .optional()
            .describe("true 时替换所有匹配项；默认 false 且要求唯一匹配"),
        })
        .optional()
        .describe("高级选项"),
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
    description: `执行单条文件系统命令（非 shell）。每次调用仅一条命令，不支持 &&、|、; 等链式语法。

支持的子命令：
- ls [ -r ] <dir> — 列目录；-r 递归
- rm <path> / rm -r <path> — 删文件或递归删目录
- rmdir <path> — 删空目录
- mv <from> <to> — 移动或重命名
- cp <from> <to> / cp -r <from> <to> — 复制文件或目录
- mkdir <path> — 创建目录

与 read/write/edit 区别：fs 管路径级操作（增删移复制、列目录）；改文件内容用 write/edit。`,
    inputSchema: z.object({
      command: z
        .string()
        .min(1)
        .describe(
          "单条 fs 子命令字符串，例如 `ls src`、`rm -r tmp`、`mv a.txt b.txt`",
        ),
    }),
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
    description: `按 glob 模式在工作区中查找路径列表。只返回路径，不读文件内容。

用法：
- pattern：glob 模式，如 \`**/*.ts\`、\`src/**\`
- options.cwd：可选，限定搜索根目录；省略则在整个工作区范围搜索

结果过多时会截断（见返回 truncated/total）。找到路径后通常再用 read 读取内容。`,
    inputSchema: z.object({
      pattern: z
        .string()
        .min(1)
        .describe("glob 模式，例如 `**/*.md` 或 `src/**/*.ts`"),
      options: z
        .object({
          cwd: z
            .string()
            .optional()
            .describe("可选：相对或绝对目录，作为模式匹配根路径"),
        })
        .optional()
        .describe("搜索范围选项"),
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
    {
      pattern: string;
      options?: {
        pathPrefix?: string;
        pathGlob?: string;
        matchMode?: "auto" | "literal" | "regex";
        caseInsensitive?: boolean;
        invert?: boolean;
        contextLines?: number;
        oneMatchPerFile?: boolean;
      };
    },
    GrepToolOutput,
    BuiltinToolContext
  > = {
    name: "grep",
    description: `在工作区文件**内容**中搜索，返回 path、行号、列号与 excerpt。

用法：
- pattern：搜索模式；默认 matchMode=auto（先尝试正则，失败则按字面量子串）
- pathPrefix / pathGlob：缩小搜索文件范围（路径前缀或 glob，如 \`**/*.md\`）
- caseInsensitive：忽略大小写
- invert：为 true 时返回**不包含** pattern 的行
- contextLines：在 excerpt 中附带命中行上下若干行上下文
- oneMatchPerFile：每个文件至多返回一条命中

与 glob 区别：glob 按路径名匹配；grep 读文件内容。结果过多时会截断（最多 100 条 / 50KB）。`,
    inputSchema: z.object({
      pattern: z
        .string()
        .min(1)
        .describe("搜索模式；auto 模式下合法正则按正则匹配，否则字面量"),
      options: z
        .object({
          pathPrefix: z
            .string()
            .optional()
            .describe("仅搜索路径以该前缀开头的文件"),
          pathGlob: z
            .string()
            .optional()
            .describe("仅搜索路径匹配该 glob 的文件，如 `**/*.ts`"),
          matchMode: z
            .enum(["auto", "literal", "regex"])
            .optional()
            .describe("auto：先正则后字面量；literal：子串；regex：纯正则"),
          caseInsensitive: z
            .boolean()
            .optional()
            .describe("忽略大小写"),
          invert: z
            .boolean()
            .optional()
            .describe("为 true 时返回不匹配 pattern 的行"),
          contextLines: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("excerpt 中附带命中行前后各 N 行上下文"),
          oneMatchPerFile: z
            .boolean()
            .optional()
            .describe("为 true 时每个文件至多一条命中"),
        })
        .optional()
        .describe("高级搜索选项"),
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

/**
 * 整文件 write 成功后写入 session `file_cache` 的 `full:{path}`。
 * 无 `sessionKkv` 时跳过（运行时未注入）。
 */
async function upsertFileCacheAfterWrite(
  ctx: BuiltinToolContext,
  path: string,
  content: string,
): Promise<void> {
  if (ctx.sessionKkv == null) {
    return;
  }
  const logicalPath = normalizePath(path);
  const key = fileCacheKey("full", logicalPath);
  await ctx.sessionKkv.set(
    ctx.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
    serializeFileCachePayload({ body: content, mtimeMs: Date.now() }),
  );
}

export type { VfsReadResult };
export type { BuiltinToolContext } from "./builtin-tool-context.js";
/** @deprecated Use {@link BuiltinToolContext}. */
export type { VfsToolContext } from "./builtin-tool-context.js";
