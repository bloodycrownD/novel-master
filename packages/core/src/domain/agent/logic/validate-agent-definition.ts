/**
 * Business validation for {@link AgentDefinition}.
 *
 * @module domain/agent/validate-agent-definition
 */

import { validateAgentToolPolicy } from "./validate-agent-tool-policy.js";
import type { AgentDefinition } from "../model/agent-definition.js";
import { agentDefinitionSchema } from "../model/agent-definition.schema.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import { decode } from "@/infra/serialization/decode.js";

export interface ValidateAgentDefinitionOptions {
  /** Ensures model pin refers to a saved model (CLI injects). */
  readonly assertSavedModel?: (savedModelId: string) => void | Promise<void>;
  /** Registered tool names for tools policy validation (host injects after registerVfsTools). */
  readonly registeredToolNames?: readonly string[];
}

/**
 * Validates optional model pin when host supplies saved-model lookup.
 *
 * @throws {AgentConfigError} `INVALID_SCHEMA` 字段缺失 / 形状错误（含毒行拦截）；
 *   `INVALID_TOOL_POLICY` 工具策略引用未注册工具名。
 */
export async function validateAgentDefinition(
  def: AgentDefinition,
  options: ValidateAgentDefinitionOptions = {}
): Promise<void> {
  if (options.registeredToolNames != null) {
    validateAgentToolPolicy(def.tools, new Set(options.registeredToolNames));
  }

  assertWritableAgentDefinitionShape(def);

  const pin = def.model;
  if (pin == null || options.assertSavedModel == null) {
    return;
  }
  await options.assertSavedModel(pin);
}

/**
 * 写入门禁：拦截字段缺失 / 形状错误的 definition。
 *
 * WHY：`agent` 工具 create/update 把 LLM 的原始 JSON 直接收进来（D5 宽松收包），
 * 字段级校验是本函数的职责。缺 name 曾在 `AgentRegistryService.upsert` 的
 * `def.name.trim()` 裸抛 TypeError；形状错误的行还可能「写得进、读不出」——
 * 读侧 `rowToDefinition` 走 strict zod decode，一行毒数据会让整个注册表
 * list()/get() 全部失败。故在写入前完成与读侧同一 schema 的往返校验。
 */
function assertWritableAgentDefinitionShape(def: AgentDefinition): void {
  // name：顶层必填（工具参数 name 仅用于 get/update 定位，不能替代）。
  if (typeof def.name !== "string" || def.name.trim().length === 0) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "definition.name 必填且为非空字符串（写在 definition 顶层；工具参数 name 仅用于定位，不能替代）"
    );
  }
  // description：可省略，但给出时必须是字符串（序列化 toWire 会 trim）。
  if (def.description != null && typeof def.description !== "string") {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "definition.description 如填写必须为字符串"
    );
  }
  // prompts：必填对象，persist / dynamic 为块数组（域格式，对齐 get 的输出），
  // 不是 wire 格式的「块名 → 块」对象映射。
  const prompts = def.prompts as
    | { persist?: unknown; dynamic?: unknown }
    | null
    | undefined;
  if (
    prompts == null ||
    typeof prompts !== "object" ||
    Array.isArray(prompts) ||
    !Array.isArray(prompts.persist) ||
    !Array.isArray(prompts.dynamic)
  ) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "definition.prompts 必填且含 persist / dynamic 块数组（结构对齐 get 的输出，不是以块名为键的对象映射）"
    );
  }
  // 终极防线：wire 往返（toWire → 与读侧同一 schema decode）。mode / model
  // uuid / runtime / 块形状 / 未知键等其余字段错误在此以 zod 消息拒绝，
  // 保证写入门禁与读门禁完全一致。toWire 对畸形输入可能抛 TypeError，统一转译。
  try {
    decode(agentDefinitionSchema.toWire(def), agentDefinitionSchema);
  } catch (error) {
    if (error instanceof AgentConfigError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      `definition 字段不合法：${detail}`
    );
  }
}
