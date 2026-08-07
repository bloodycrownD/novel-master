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

  /**
   * 人类可读描述；按运行时上下文动态生成（如 task 工具拼候选 subagent 名单）。
   *
   * 由 {@link toolsFromRegistry} 在装配期调 `description(ctx)` 求值成 string。
   */
  readonly description: (ctx: Ctx) => string;

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

