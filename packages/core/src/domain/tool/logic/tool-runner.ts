/**
 * Tool runner: validate input/output and normalize errors.
 *
 * @module domain/tool/tool-runner
 */

import { ZodError } from "zod";
import {
  toolFailed,
  toolInvalidArgument,
  toolNotFound,
  type ToolError,
} from "@/errors/tool-errors.js";
import { parseFsCommand } from "./fs-command.js";
import type { ToolRegistry } from "./tool-registry.js";

/** A single tool invocation for parallel dispatch. */
export interface ToolCall {
  readonly name: string;
  readonly input: unknown;
}

/** Outcome of one parallel tool invocation (errors are captured, not thrown). */
export type ParallelToolOutcome =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly error: unknown };

const DEFAULT_PARALLEL_CONCURRENCY = 8;

/**
 * Runs async tasks with a bounded concurrency (fork-join helper).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        break;
      }
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 提取突变 tool 调用涉及的路径，用于同 path 串行化。 */
function extractMutatingPaths(call: ToolCall): readonly string[] | null {
  if (call.name === "write" || call.name === "edit") {
    const path =
      typeof (call.input as { path?: unknown }).path === "string"
        ? (call.input as { path: string }).path
        : "";
    return path.length > 0 ? [path] : null;
  }
  if (call.name === "fs") {
    const command =
      typeof (call.input as { command?: unknown }).command === "string"
        ? (call.input as { command: string }).command
        : "";
    if (command === "") {
      return null;
    }
    try {
      const parsed = parseFsCommand(command);
      switch (parsed.kind) {
        case "ls":
          return null;
        case "rm":
        case "rmdir":
        case "mkdir":
          return [parsed.path];
        case "mv":
          return [parsed.from, parsed.to];
        case "cp":
          return [parsed.from, parsed.to];
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Executes tools from a registry with schema validation and consistent errors.
 *
 * @remarks
 * - NOT_FOUND, INVALID_ARGUMENT, FAILED are always surfaced as {@link ToolError}.
 * - Underlying failures are preserved via `cause` (see {@link ToolError}).
 */
export class ToolRunner<Ctx = unknown> {
  constructor(private readonly registry: ToolRegistry<Ctx>) {}

  /**
   * Calls a tool by name with input and context.
   *
   * @throws ToolError NOT_FOUND when tool missing
   * @throws ToolError INVALID_ARGUMENT when input invalid
   * @throws ToolError FAILED when tool throws or output violates schema
   */
  async call<Output = unknown>(
    name: string,
    input: unknown,
    ctx: Ctx,
  ): Promise<Output> {
    const tool = this.registry.get(name);
    if (!tool) {
      throw toolNotFound(name);
    }

    const parsedIn = tool.inputSchema.safeParse(input);
    if (!parsedIn.success) {
      throw toolInvalidArgument(name, parsedIn.error.issues);
    }

    try {
      const out = await tool.run(parsedIn.data, ctx);

      if (tool.outputSchema) {
        const parsedOut = tool.outputSchema.safeParse(out);
        if (!parsedOut.success) {
          throw toolFailed(name, parsedOut.error);
        }
        return parsedOut.data as Output;
      }

      return out as Output;
    } catch (e: unknown) {
      if (isToolError(e)) {
        throw e;
      }
      if (e instanceof ZodError) {
        // Defensive: a tool might throw a ZodError directly.
        throw toolFailed(name, e);
      }
      throw toolFailed(name, e);
    }
  }

  /**
   * Runs multiple tool calls in parallel with bounded concurrency.
   *
   * @remarks Individual failures are captured in {@link ParallelToolOutcome}; order matches `calls`.
   */
  async runParallel(
    calls: readonly ToolCall[],
    ctx: Ctx,
    options?: { concurrency?: number },
  ): Promise<ParallelToolOutcome[]> {
    const concurrency = options?.concurrency ?? DEFAULT_PARALLEL_CONCURRENCY;
    const pathTail = new Map<string, Promise<void>>();

    return mapWithConcurrency(calls, concurrency, async (call) => {
      const paths = extractMutatingPaths(call);
      let release: (() => void) | undefined;

      if (paths != null && paths.length > 0) {
        const prevTails = paths.map(
          (path) => pathTail.get(path) ?? Promise.resolve(),
        );
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const myTail = Promise.all(prevTails).then(() => gate);
        for (const path of paths) {
          pathTail.set(path, myTail);
        }
        await Promise.all(prevTails);
      }

      try {
        try {
          const output = await this.call(call.name, call.input, ctx);
          return { ok: true as const, output };
        } catch (error: unknown) {
          return { ok: false as const, error };
        }
      } finally {
        release?.();
      }
    });
  }
}

function isToolError(e: unknown): e is ToolError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "ToolError" &&
    typeof (e as { code?: unknown }).code === "string"
  );
}
