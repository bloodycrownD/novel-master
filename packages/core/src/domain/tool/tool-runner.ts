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
} from "./tool-errors.js";
import type { ToolRegistry } from "./tool-registry.js";

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
}

function isToolError(e: unknown): e is ToolError {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "ToolError" &&
    typeof (e as { code?: unknown }).code === "string"
  );
}

