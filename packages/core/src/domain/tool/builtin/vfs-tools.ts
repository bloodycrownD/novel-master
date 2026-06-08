/**
 * Builtin workspace file tools backed by {@link VfsService}.
 *
 * @module domain/tool/builtin/vfs-tools
 */

import { z } from "zod";

import type { Tool } from "../model/tool.js";
import type {
  VfsGrepMatch,
  VfsListEntry,
  VfsReadResult,
  VfsService,
  WriteOptions,
} from "@/domain/vfs/ports/vfs-service.port.js";
import { copyVfsPath } from "@/domain/vfs/logic/vfs-copy.js";
import { moveVfsPath } from "@/domain/vfs/logic/vfs-move.js";
import type { ToolRegistry } from "../logic/tool-registry.js";

/**
 * Context for builtin file tools: session-scoped, revision-aware {@link VfsService}.
 *
 * @remarks Mutating tools write directly to VFS; checkpoint capture runs at Agent step boundary.
 */
export type VfsToolContext = {
  readonly vfs: VfsService;
  readonly projectId: string;
  readonly sessionId: string;
};

/** Registered builtin file tool names (insertion order). */
export const FILE_TOOL_NAMES = [
  "read",
  "write",
  "replace",
  "delete",
  "list",
  "mkdir",
  "glob",
  "grep",
  "move",
  "copy",
] as const;

export type FileToolName = (typeof FILE_TOOL_NAMES)[number];

/** Tools that mutate session file content (checkpoint-eligible). */
export const MUTATING_FILE_TOOL_NAMES = new Set<FileToolName>([
  "write",
  "replace",
  "delete",
  "mkdir",
  "move",
  "copy",
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
  "replace",
]);

/** Maps legacy agent policy `vfs.read` → `read`. */
export function normalizeAgentToolPolicyName(name: string): string {
  return name.startsWith("vfs.") ? name.slice(4) : name;
}

/**
 * Creates the builtin workspace file tools.
 *
 * @remarks
 * Visibility and access rules come from the injected `VfsService` instance
 * (global / project / session scope). Mutations append revisions via the revision-aware wrapper.
 */
export function createVfsTools(): readonly Tool<any, any, VfsToolContext>[] {
  const read: Tool<{ path: string }, VfsReadResult, VfsToolContext> = {
    name: "read",
    description: "读取工作区文件内容",
    inputSchema: z.object({ path: z.string().min(1) }),
    outputSchema: z.object({
      path: z.string(),
      content: z.string(),
      version: z.number().int(),
      mtimeMs: z.number(),
    }),
    async run(input, ctx) {
      return await ctx.vfs.read(input.path);
    },
  };

  const write: Tool<
    { path: string; content: string; options?: WriteOptions },
    { version: number },
    VfsToolContext
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
      const versionCheck = input.options?.versionCheck ?? true;
      return await ctx.vfs.write(input.path, input.content, {
        versionCheck,
        ...(input.options?.expectedVersion != null
          ? { expectedVersion: input.options.expectedVersion }
          : {}),
      });
    },
  };

  const replace: Tool<
    {
      path: string;
      oldString: string;
      newString: string;
      options?: { replaceAll?: boolean };
    },
    { version: number; replacements: number },
    VfsToolContext
  > = {
    name: "replace",
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

  const del: Tool<
    { path: string; options?: { recursive?: boolean } },
    { ok: true },
    VfsToolContext
  > = {
    name: "delete",
    description:
      "删除工作区中的文件或空目录；recursive 为 true 时可删除目录树",
    inputSchema: z.object({
      path: z.string().min(1),
      options: z.object({ recursive: z.boolean().optional() }).optional(),
    }),
    outputSchema: z.object({ ok: z.literal(true) }),
    async run(input, ctx) {
      await ctx.vfs.delete(input.path, {
        recursive: input.options?.recursive ?? false,
      });
      return { ok: true as const };
    },
  };

  const list: Tool<
    { dir: string; options?: { recursive?: boolean; maxDepth?: number } },
    VfsListEntry[],
    VfsToolContext
  > = {
    name: "list",
    description: "列出工作区目录下的文件与子目录",
    inputSchema: z.object({
      dir: z.string().min(1),
      options: z
        .object({
          recursive: z.boolean().optional(),
          maxDepth: z.number().int().optional(),
        })
        .optional(),
    }),
    outputSchema: z.array(
      z.object({
        path: z.string(),
        kind: z.enum(["file", "directory"]),
      }),
    ),
    async run(input, ctx) {
      return await ctx.vfs.list(input.dir, input.options);
    },
  };

  const mkdir: Tool<{ path: string }, { ok: true }, VfsToolContext> = {
    name: "mkdir",
    description: "在工作区创建空目录（父目录须已存在）",
    inputSchema: z.object({ path: z.string().min(1) }),
    outputSchema: z.object({ ok: z.literal(true) }),
    async run(input, ctx) {
      await ctx.vfs.mkdir(input.path);
      return { ok: true as const };
    },
  };

  const glob: Tool<
    { pattern: string; options?: { cwd?: string } },
    string[],
    VfsToolContext
  > = {
    name: "glob",
    description: "按 glob 模式在工作区中查找路径",
    inputSchema: z.object({
      pattern: z.string().min(1),
      options: z.object({ cwd: z.string().optional() }).optional(),
    }),
    outputSchema: z.array(z.string()),
    async run(input, ctx) {
      return await ctx.vfs.glob(input.pattern, input.options);
    },
  };

  const grep: Tool<
    { pattern: string; options?: { pathPrefix?: string } },
    VfsGrepMatch[],
    VfsToolContext
  > = {
    name: "grep",
    description: "在工作区文件中搜索文本或正则",
    inputSchema: z.object({
      pattern: z.string().min(1),
      options: z.object({ pathPrefix: z.string().optional() }).optional(),
    }),
    outputSchema: z.array(
      z.object({
        path: z.string(),
        line: z.number().int(),
        column: z.number().int(),
        excerpt: z.string(),
      }),
    ),
    async run(input, ctx) {
      return await ctx.vfs.grep(input.pattern, input.options);
    },
  };

  const move: Tool<
    { from: string; to: string },
    { ok: true },
    VfsToolContext
  > = {
    name: "move",
    description: "移动或重命名工作区中的文件/目录",
    inputSchema: z.object({
      from: z.string().min(1),
      to: z.string().min(1),
    }),
    outputSchema: z.object({ ok: z.literal(true) }),
    async run(input, ctx) {
      await moveVfsPath(ctx.vfs, input.from, input.to);
      return { ok: true as const };
    },
  };

  const copy: Tool<
    {
      from: string;
      to: string;
      options?: { recursive?: boolean };
    },
    { ok: true },
    VfsToolContext
  > = {
    name: "copy",
    description: "复制工作区文件；目录复制需设置 options.recursive 为 true",
    inputSchema: z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      options: z.object({ recursive: z.boolean().optional() }).optional(),
    }),
    outputSchema: z.object({ ok: z.literal(true) }),
    async run(input, ctx) {
      await copyVfsPath(ctx.vfs, input.from, input.to, input.options);
      return { ok: true as const };
    },
  };

  return [read, write, replace, del, list, mkdir, glob, grep, move, copy];
}

/**
 * Registers builtin file tools into a registry.
 *
 * @throws ToolError CONFLICT when a builtin name is already registered
 */
export function registerVfsTools(registry: ToolRegistry<VfsToolContext>): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
}
