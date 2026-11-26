/**
 * Tool model: schema-validated callable units.
 *
 * @module domain/tool/model/tool
 */

import type { z } from "zod";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

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
     * 给模型看的入参定义，已是 JSON Schema；给了就不从 {@link inputSchema} 转换。
     *
     * @remarks
     * 给「校验宽松、但定义由外部声明」的工具用（如 MCP：入参交给远端 server 校验，
     * 参数定义照它声明的原样透出）。本地校验仍走 {@link inputSchema}。
     */
    readonly inputJsonSchema?: Readonly<Record<string, unknown>>;

    /**
     * Optional output validation schema.
   *
   * @remarks
   * If provided, the runner validates tool outputs to catch contract violations
   * early (especially useful in tests).
   */
    readonly outputSchema?: z.ZodType<Output>;

    /**
   * Executes the tool. Implementations should be side-effect safe by default.
   *
   * @remarks 已知失败走返回值通道（四期门⑦）：实现内 `Result` 失败一律
   * `return r` 接力，不再解包 throw；未知异常仍可抛，由 runner 统一收口。
   */
    run(input: Input, ctx: Ctx): Promise<Result<Output, AppError>>;
}
