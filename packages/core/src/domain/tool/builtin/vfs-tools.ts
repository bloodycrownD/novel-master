/**
 * Builtin VFS tools (`vfs.*`) backed by {@link VfsService}.
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
 * Context for builtin VFS tools: session-scoped, revision-aware {@link VfsService}.
 *
 * @remarks Mutating tools write directly to VFS; checkpoint capture runs at Agent step boundary.
 */
export type VfsToolContext = {
  readonly vfs: VfsService;
  readonly projectId: string;
  readonly sessionId: string;
};

/** Builtin tool names that mutate session file content (checkpoint-eligible). */
export const MUTATING_VFS_TOOL_NAMES = new Set([
  "vfs.write",
  "vfs.replace",
  "vfs.delete",
  "vfs.mkdir",
  "vfs.move",
  "vfs.copy",
]);

/** Returns whether a tool name performs VFS mutations for checkpoint purposes. */
export function isMutatingVfsToolName(name: string): boolean {
  return MUTATING_VFS_TOOL_NAMES.has(name);
}

/**
 * Creates the builtin VFS tools.
 *
 * @remarks
 * Visibility and access rules come from the injected `VfsService` instance
 * (e.g. session-scoped VFS). Mutations append revisions via the revision-aware wrapper.
 */
export function createVfsTools(): readonly Tool<any, any, VfsToolContext>[] {
  const read: Tool<{ path: string }, VfsReadResult, VfsToolContext> = {
    name: "vfs.read",
    description: "Read a file by path",
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
    name: "vfs.write",
    description: "Write file content (with optional version check)",
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
    name: "vfs.replace",
    description: "Replace string in file content",
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
    name: "vfs.delete",
    description:
      "Delete a file or empty directory; set recursive to remove a directory tree",
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
    name: "vfs.list",
    description: "List VFS entries under a directory",
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
    name: "vfs.mkdir",
    description: "Create an empty directory at path (parent must exist)",
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
    name: "vfs.glob",
    description: "Find matching paths using glob patterns",
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
    name: "vfs.grep",
    description: "Search for a pattern in files",
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
    name: "vfs.move",
    description: "Move or rename a file or directory",
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
    name: "vfs.copy",
    description: "Copy a file; directory copy requires options.recursive true",
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
 * Registers builtin VFS tools into a registry.
 *
 * @throws ToolError CONFLICT when a builtin name is already registered
 */
export function registerVfsTools(registry: ToolRegistry<VfsToolContext>): void {
  for (const tool of createVfsTools()) {
    registry.register(tool);
  }
}
