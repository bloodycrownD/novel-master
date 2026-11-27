/**
 * Tool model: schema-validated callable units.
 *
 * @module domain/tool/model/tool
 */

import type { z } from "zod";
import type { AppError } from "@/errors/app-error.js";
import type { Result } from "@/errors/either.js";

/**
 * A single executable tool definition（自带工具：入参出参都由 zod schema 校验）.
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
   * 由 `ToolDefinitions.fromRegistry` 在装配期调 `description(ctx)` 求值成 string。
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

    /**
   * Executes the tool. Implementations should be side-effect safe by default.
   *
   * @remarks 已知失败走返回值通道（四期门⑦）：实现内 `Result` 失败一律
   * `return r` 接力，不再解包 throw；未知异常仍可抛，由 runner 统一收口。
   */
    run(input: Input, ctx: Ctx): Promise<Result<Output, AppError>>;
}

/**
 * 外部工具（如 MCP server 提供的工具）：参数定义是提供方现成的 JSON Schema，
 * 原样透给模型、不本地校验（校验权威是提供方，错因随调用往返带回）。
 *
 * @remarks
 * 与 {@link Tool} 的判别方式是 `"inputSchema" in tool`：自带工具带 zod
 * `inputSchema`，外部工具带 `inputJsonSchema`；执行器对外部工具跳过入参出参
 * 校验，原始参数直接给 `run`，路径白名单检查照旧。
 */
export interface ExternalTool<Ctx = unknown> {
    /** Globally unique tool name（如 `mcp__db__query`）。 */
    readonly name: string;

    /** 人类可读描述；与 {@link Tool.description} 同一装配期求值约定。 */
    readonly description: (ctx: Ctx) => string;

    /** 提供方声明的入参 JSON Schema，模型侧参数定义原样取自它。 */
    readonly inputJsonSchema: Readonly<Record<string, unknown>>;

    /** 原始入参不经校验直达；成功值也不经 schema 校验原样返回。 */
    run(input: unknown, ctx: Ctx): Promise<Result<unknown, AppError>>;
}

/** 注册表统一存储形态：自带工具（zod 校验）或外部工具（现成 JSON Schema）。 */
export type RegisteredTool<Ctx = unknown> = Tool<any, any, Ctx> | ExternalTool<Ctx>;
