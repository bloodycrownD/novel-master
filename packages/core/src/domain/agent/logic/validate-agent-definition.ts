/**
 * Business validation for {@link AgentDefinition}.
 *
 * @module domain/agent/validate-agent-definition
 */

import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { LocalizedMessage } from "@/i18n/localized-message.js";
import { SerializationDecode } from "@/common/serialization/decode.js";
import { AgentToolPolicyValidator } from "./validate-agent-tool-policy.js";
import type { AgentDefinition } from "../model/agent-definition.js";
import { agentDefinitionSchema } from "../model/agent-definition.schema.js";

/** 本模块的失败载荷：字段形状 / 工具策略 / 模型 pin。 */
type AgentValidationError = AppError<"AGENT_INVALID_SCHEMA" | "AGENT_INVALID_TOOL_POLICY" | "AGENT_INVALID_MODEL">;

export interface ValidateAgentDefinitionOptions {
    /**
   * Ensures model pin refers to a saved model (CLI injects).
   *
   * 已知失败沿返回值（四期门⑦）：回调可返回 `Result`（Err 收编为
   * `AGENT_INVALID_MODEL`，detail 转码与旧 throw 路径逐字一致）；void /
   * throw 通道保留向后兼容，宿主未迁移时行为不变。
   */
    readonly assertSavedModel?: (savedModelId: string) => void | Result<void, AppError> | Promise<void | Result<void, AppError>>;
    /** Registered tool names for tools policy validation (host injects after registerVfsTools). */
    readonly registeredToolNames?: readonly string[];
}

export const AgentDefinitionValidator = {
    /**
   * Validates optional model pin when host supplies saved-model lookup.
   *
   * 所有校验失败都收进 Result.err，本函数不抛异常：
   * - `AGENT_INVALID_SCHEMA`：字段缺失 / 形状错误（含毒行拦截）；
   * - `AGENT_INVALID_TOOL_POLICY`：工具策略引用未注册工具名；
   * - `AGENT_INVALID_MODEL`：宿主 assertSavedModel 拒绝模型 pin。
   *
   * 写入门禁拦截字段缺失 / 形状错误的 definition。WHY：`agent` 工具 create/update
   * 把 LLM 的原始 JSON 直接收进来（D5 宽松收包），字段级校验是本函数的职责。
   * 缺 name 曾在 `AgentRegistryService.upsert` 的 `def.name.trim()` 裸抛 TypeError；
   * 形状错误的行还可能「写得进、读不出」——读侧 `rowToDefinition` 走 strict zod decode，
   * 一行毒数据会让整个注册表 list()/get() 全部失败。故在写入前完成与读侧同一 schema
   * 的往返校验。
   */
    async validate(def: AgentDefinition, options: ValidateAgentDefinitionOptions = {}): Promise<Result<void, AgentValidationError>> {
        if (options.registeredToolNames != null) {
            const policy = AgentToolPolicyValidator.validate(def.tools, new Set(options.registeredToolNames));
            if (!policy.ok) {
                return Result.err(policy.error);
            }
        }
        // 入参按不可信处理：agent 工具会把 LLM 原始 JSON 直接塞进来，类型断言不保证运行时形状。
        const name: unknown = def.name;
        if (typeof name !== "string" || name.trim().length === 0) {
            return Result.err(new AppError("AGENT_INVALID_SCHEMA", { descriptor: { key: "error.agent.invalid_schema.name_required" } }));
        }
        // description：可省略，但给出时必须是字符串（序列化 toWire 会 trim）。
        const description: unknown = def.description;
        if (description != null && typeof description !== "string") {
            return Result.err(new AppError("AGENT_INVALID_SCHEMA", { descriptor: { key: "error.agent.invalid_schema.description_type" } }));
        }
        // prompts：必填对象，persist / dynamic 为块数组（域格式，对齐 get 的输出），
        // 不是 wire 格式的「块名 → 块」对象映射。
        const prompts = def.prompts as { persist?: unknown; dynamic?: unknown } | null | undefined;
        if (prompts == null || !Array.isArray(prompts.persist) || !Array.isArray(prompts.dynamic)) {
            return Result.err(new AppError("AGENT_INVALID_SCHEMA", { descriptor: { key: "error.agent.invalid_schema.prompts_shape" } }));
        }
        // 终极防线：wire 往返（toWire → 与读侧同一 schema decode）。mode / model
        // uuid / runtime / 块形状 / 未知键等其余字段错误在此以 zod 消息拒绝，
        // 保证写入门禁与读门禁完全一致。toWire 对畸形输入可能抛 TypeError，统一转译。
        try {
            // toWire 的块名唯一性门禁已 Result 化（五期门⑦）：Err 走与旧 catch 同一条转译。
            const wire = agentDefinitionSchema.toWire(def);
            if (!wire.ok) {
                const detail = wire.error.message;
                return Result.err(new AppError("AGENT_INVALID_SCHEMA", { descriptor: { key: "error.agent.invalid_schema.field_invalid", params: { detail: LocalizedMessage.paramOf(detail) } } }));
            }
            // decode 已 Result 化（错误通道迁移四期）：Err 走与旧 catch 同一条转译。
            const decoded = SerializationDecode.decode(wire.value, agentDefinitionSchema);
            if (!decoded.ok) {
                const detail = decoded.error.message;
                return Result.err(new AppError("AGENT_INVALID_SCHEMA", { descriptor: { key: "error.agent.invalid_schema.field_invalid", params: { detail: LocalizedMessage.paramOf(detail) } } }));
            }
        } catch (error) {
            // schema 层同步失败协议（读侧 transform / preprocess 抛 PROMPT_* 等）在这里
            // 统一转译成定义级失败，保留原始 message。
            const detail = error instanceof Error ? error.message : String(error);
            return Result.err(new AppError("AGENT_INVALID_SCHEMA", { descriptor: { key: "error.agent.invalid_schema.field_invalid", params: { detail: LocalizedMessage.paramOf(detail) } } }));
        }
        const pin = def.model;
        if (pin == null || options.assertSavedModel == null) {
            return Result.ok(undefined);
        }
        try {
            const outcome = await options.assertSavedModel(pin);
            if (outcome != null && !outcome.ok) {
                // Err 沿返回值到达（四期门⑦）：detail 转码与旧 throw 路径逐字一致。
                const detail = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
                return Result.err(new AppError("AGENT_INVALID_MODEL", { detail: detail, modelId: pin }));
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            return Result.err(new AppError("AGENT_INVALID_MODEL", { detail: detail, modelId: pin }));
        }
        return Result.ok(undefined);
    },
} as const;
