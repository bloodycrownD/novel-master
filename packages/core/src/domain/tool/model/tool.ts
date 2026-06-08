/**
 * Tool model: schema-validated callable units.
 *
 * @module domain/tool/model/tool
 */

import type { z } from "zod";

/**
 * A single executable tool definition.
 *
 * @remarks
 * Tools are intentionally protocol-agnostic: they don't assume any particular LLM
 * tool-calling format (blocks/messages). They can be registered and invoked by
 * higher-level dispatchers.
 */
export interface Tool<Input, Output, Ctx = unknown> {
  /** Globally unique tool name (e.g. `read`). */
  readonly name: string;

  /** Human readable description for logs/UX. */
  readonly description: string;

  /** Input validation schema. */
  readonly inputSchema: z.ZodType<Input>;

  /**
   * Optional output validation schema.
   *
   * @remarks
   * If provided, the runner validates tool outputs to catch contract violations
   * early (especially useful in tests).
   */
  readonly outputSchema?: z.ZodType<Output>;

  /** Executes the tool. Implementations should be side-effect safe by default. */
  run(input: Input, ctx: Ctx): Promise<Output>;
}

