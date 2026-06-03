/**
 * Builtin VFS tools (`vfs.*`) backed by {@link VfsService}.
 *
 * @module domain/tool/builtin/vfs-tools
 */

import { z } from "zod";
import { vfsReplaceNotFound } from "@/errors/vfs-errors.js";
import type { Tool } from "../model/tool.js";
import type {
  VfsGrepMatch,
  VfsListEntry,
  VfsReadResult,
  VfsService,
  WriteOptions,
} from "@/domain/vfs/ports/vfs-service.port.js";
import type {
  SessionFsAction,
  SessionFsExecuteOptions,
  SessionFsExecuteRound,
  SessionFsService,
} from "@/service/session-fs/session-fs.port.js";
import type { ToolRegistry } from "../logic/tool-registry.js";

/**
 * Context for builtin VFS tools: reads/list/glob/grep/mkdir use `vfs` directly;
 * write/replace mutations use `sessionFs` for rollback batches.
 */
export type VfsToolContext = {
  readonly vfs: VfsService;
  readonly sessionFs: SessionFsService;
  readonly projectId: string;
  readonly sessionId: string;
  /** When set by AgentRunner, mutating tools share one batch per assistant message. */
  executeRound?: SessionFsExecuteRound;
};

async function executeMutating(
  ctx: VfsToolContext,
  actions: SessionFsAction[],
  opts?: Pick<SessionFsExecuteOptions, "versionCheck" | "expectedVersion">,
): Promise<{ batchId: string; results: Awaited<ReturnType<SessionFsService["execute"]>>["results"] }> {
  assertSessionFsExecute(ctx);
  const round = ctx.executeRound;
  if (round == null) {
    return await ctx.sessionFs.execute(
      ctx.sessionId,
      ctx.projectId,
      actions,
      "assistant",
      opts,
    );
  }
  const result = await ctx.sessionFs.execute(
    ctx.sessionId,
    ctx.projectId,
    actions,
    "assistant",
    {
      ...opts,
      messageId: round.batchId == null ? round.messageId : undefined,
      continueBatchId: round.batchId ?? undefined,
    },
  );
  round.batchId = result.batchId;
  return result;
}

function assertSessionFsExecute(
  ctx: VfsToolContext,
): asserts ctx is VfsToolContext & {
  sessionFs: SessionFsService & {
    execute: NonNullable<SessionFsService['execute']>;
  };
} {
  if (typeof ctx.sessionFs.execute !== "function") {
    // WHY: surface a deterministic tool error when runtime wiring is stale/broken
    // (e.g. HMR stale object), instead of opaque "undefined is not a function".
    throw new Error("sessionFs.execute is unavailable in vfs tool context");
  }
}

/**
 * Creates the builtin VFS tools.
 *
 * @remarks
 * Visibility and access rules come from the injected `VfsService` instance
 * (e.g. session-scoped VFS). `vfs.write` and `vfs.replace` route through
 * `sessionFs.execute` for rollback batches; `vfs.mkdir` calls `vfs.mkdir` directly.
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
      const result = await executeMutating(
        ctx,
        [{ function: "write", path: input.path, content: input.content }],
        {
          versionCheck,
          ...(input.options?.expectedVersion != null
            ? { expectedVersion: input.options.expectedVersion }
            : {}),
        },
      );
      const writeResult = result.results.find((r) => r.function === "write");
      if (writeResult == null || writeResult.function !== "write") {
        throw new Error("sessionFs.execute did not return a write result");
      }
      return { version: writeResult.version };
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
      assertSessionFsExecute(ctx);
      const current = await ctx.vfs.read(input.path);
      let replacements = 0;
      let nextContent = current.content;

      if (input.options?.replaceAll) {
        if (!current.content.includes(input.oldString)) {
          throw vfsReplaceNotFound(input.path);
        }
        const parts = current.content.split(input.oldString);
        replacements = parts.length - 1;
        nextContent = parts.join(input.newString);
      } else {
        const index = current.content.indexOf(input.oldString);
        if (index === -1) {
          throw vfsReplaceNotFound(input.path);
        }
        replacements = 1;
        nextContent =
          current.content.slice(0, index) +
          input.newString +
          current.content.slice(index + input.oldString.length);
      }

      // Single write batch after in-memory replace (read stays outside the batch).
      const result = await executeMutating(ctx, [
        { function: "write", path: input.path, content: nextContent },
      ]);
      const writeResult = result.results.find((r) => r.function === "write");
      if (writeResult == null || writeResult.function !== "write") {
        throw new Error("sessionFs.execute did not return a write result");
      }
      return { version: writeResult.version, replacements };
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

  return [read, write, replace, list, mkdir, glob, grep];
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
