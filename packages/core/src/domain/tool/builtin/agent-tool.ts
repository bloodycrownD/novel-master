/**
 * `agent` 工具实现：让主 agent 管理 agent 定义（list / get / create / update）。
 *
 * 形态照 `skill` 工具样板——单工具多 action 分发 + 扁平定位字段
 * （name / agentId）；create / update 的定义体是深层结构，扁平化不现实，
 * 用单个 `definition` 对象字段承载（D5）。schema 层宽松（passthrough），
 * 语义校验全部交 `AgentRegistryService.upsert` → `validateAgentDefinition`
 * （闭包携带 probe 注册表的 registeredToolNames）。
 *
 * description 是 lambda（照 `subagent-tool` 先例）：从装配期同步预算好的
 * `ctx.agents.agents` 快照拼「当前可管理 agent 名单」（含虚拟 seed
 * general）。`agentRegistry.list()` 返回 Promise，lambda 是同步求值不能
 * 现查——照 skills / task 的装配期预算模式，每 run 一次，回合内定义
 * 变更不即时反映。
 *
 * 定位语义：get / update 均按 name 优先（`registry.list()` 合并虚拟 seed，
 * by-name 可命中内置 general），再按 agentId（`get(id)` 不合并虚拟）。
 * update 按 name 定位时遍历 `listAgentIds()` + `getRawWire` 读名字解析
 * agentId（getRawWire 不解码，坏数据也能读；虚拟 general 无 id，命中时
 * 直接报「内置 agent 不支持修改」）。create 的 agentId 由工具侧按
 * `agent-${Date.now()}` 生成并对照 `listAgentIds()` 去重（照桌面端建空白
 * agent 先例）。
 *
 * 无 delete 动作（D7）：删除仅走用户界面的 agent 管理，工具描述明示这一
 * 限制。输出限流复用 `tool-output-limits.ts`：list 走 capMatchList（条数 +
 * 字节预算）；get 的定义体不截断——它是 update 回写的数据源，截断会破坏
 * 往返一致性。
 *
 * @module domain/tool/builtin/agent-tool
 */

import { z } from "zod";

import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import type { ValidateAgentDefinitionOptions } from "@/domain/agent/logic/validate-agent-definition.js";
import type { AgentRegistryService } from "@/service/agent/agent-registry.port.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import { ToolError } from "@/errors/tool-errors.js";
import type { Tool } from "../model/tool.js";
import type {
  BuiltinToolAgentsContext,
  BuiltinToolContext,
} from "./builtin-tool-context.js";
import { capMatchList, TOOL_OUTPUT_MAX_MATCHES } from "../logic/tool-output-limits.js";

/** 工具注册名（catalog / policy / 卡片解析同名字符串）。 */
export const AGENT_TOOL_NAME = "agent";

/** create / update 成功后的提示语（spec B 风险项：降低「改了没生效」误解）。 */
const AGENT_SAVED_MESSAGE = "定义已保存，将在下一次会话生效";

/** `agent` 工具输入（扁平定位字段；action 决定哪些字段必填，run 内校验）。 */
export interface AgentToolInput {
  readonly action: "list" | "get" | "create" | "update";
  /** get / update 的定位字段（name 优先，可命中内置 general）。 */
  readonly name?: string;
  /** get / update 的定位字段（按持久化 id 精确查；create 时由工具生成）。 */
  readonly agentId?: string;
  /** create / update 必填：完整 agent 定义体（schema 宽松，语义校验交服务层）。 */
  readonly definition?: Record<string, unknown>;
}

/** list 输出条目（来自装配期快照，含虚拟 seed general）。 */
export interface AgentToolListEntry {
  readonly name: string;
  readonly description?: string;
  readonly mode: NonNullable<AgentDefinition["mode"]>;
}

/** list 输出（快照映射，无 IO；超限走 capMatchList 截断）。 */
export interface AgentToolListOutput {
  readonly action: "list";
  readonly entries: readonly AgentToolListEntry[];
  readonly total: number;
  readonly truncated?: boolean;
}

/** get 输出（definition 为 registry 解码后的完整定义体，不截断）。 */
export interface AgentToolGetOutput {
  readonly action: "get";
  /** 仅按 agentId 查询时回填；按 name 查询（含虚拟 general）无 id。 */
  readonly agentId?: string;
  readonly definition: AgentDefinition;
}

/** create / update 输出（定位 + 保存提示，供摘要与 meta 透传）。 */
export interface AgentToolWriteOutput {
  readonly action: "create" | "update";
  readonly name: string;
  readonly agentId: string;
  readonly message: string;
}

export type AgentToolOutput =
  | AgentToolListOutput
  | AgentToolGetOutput
  | AgentToolWriteOutput;

/** 校验非空必填字符串字段，缺失时抛 INVALID_ARGUMENT（错误文案带字段名）。 */
function requireString(
  action: AgentToolInput["action"],
  field: string,
  value: string | undefined,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `agent 的 ${action} 动作必须提供非空 ${field}`,
      { toolName: AGENT_TOOL_NAME },
    );
  }
  return value;
}

/** 校验 create / update 必填的 definition 对象字段（形状校验；语义交服务层）。 */
function requireDefinition(
  action: "create" | "update",
  value: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (value == null || typeof value !== "object") {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `agent 的 ${action} 动作必须提供 definition（完整 agent 定义体对象）`,
      { toolName: AGENT_TOOL_NAME },
    );
  }
  return value;
}

/**
 * 从装配期快照拼给 LLM 看的「当前可管理 agent 名单」（照 formatCallableList
 * 样式，额外带 mode 方便判断能否被 task 调用）。
 */
function formatAgentEntries(
  agents: readonly AgentToolListEntry[],
): string {
  if (agents.length === 0) return "（暂无）";
  return agents
    .map((a) => {
      const desc =
        a.description != null && a.description.trim().length > 0
          ? `：${a.description.trim()}`
          : "";
      return `- ${a.name}（mode: ${a.mode}）${desc}`;
    })
    .join("\n");
}

/** 从宽松 definition 体尽力读取显示名（trim，与服务层 upsert 的归一一致）。 */
function readDefinitionName(definition: Record<string, unknown>): string {
  const name = definition["name"];
  return typeof name === "string" ? name.trim() : "";
}

/**
 * 生成新 agentId：`agent-${Date.now()}`（照桌面端建空白 agent 先例），
 * 对照 `listAgentIds()` 去重——同毫秒并发建两个时加序号重试。
 */
async function allocateAgentId(
  registry: AgentRegistryService,
): Promise<string> {
  const existing = new Set(await registry.listAgentIds());
  let candidate = `agent-${Date.now()}`;
  for (let i = 1; existing.has(candidate); i++) {
    candidate = `agent-${Date.now()}-${i}`;
  }
  return candidate;
}

/** 按 name 解析持久化 agentId（getRawWire 不解码，坏数据行也能读名）。 */
async function findAgentIdByName(
  registry: AgentRegistryService,
  name: string,
): Promise<string | undefined> {
  for (const id of await registry.listAgentIds()) {
    const wire = await registry.getRawWire(id);
    if (wire == null || typeof wire !== "object" || Array.isArray(wire)) {
      continue;
    }
    const wireName = (wire as { readonly name?: unknown }).name;
    if (typeof wireName === "string" && wireName.trim() === name) {
      return id;
    }
  }
  return undefined;
}

/** 组装 upsert 的语义校验选项（registeredToolNames / 可选 assertSavedModel）。 */
function buildValidateOptions(
  agentsCtx: BuiltinToolAgentsContext,
): ValidateAgentDefinitionOptions {
  return {
    registeredToolNames: agentsCtx.registeredToolNames,
    ...(agentsCtx.assertSavedModel != null
      ? { assertSavedModel: agentsCtx.assertSavedModel }
      : {}),
  };
}

/**
 * 调 upsert 并把服务层校验错误转成 message 含原因的 ToolError。
 *
 * WHY：`ToolRunner` 对非 ToolError 异常统一包成 `Tool failed: agent`，
 * 原始 message 只进 `cause`——LLM 看不到「哪个字段 / 哪个工具名不合法」。
 * AgentConfigError 是入参语义问题（INVALID_ARGUMENT），其余按 FAILED 透传原因。
 */
async function upsertWithTranslatedError(
  agentsCtx: BuiltinToolAgentsContext,
  agentId: string,
  definition: Record<string, unknown>,
): Promise<void> {
  try {
    await agentsCtx.registry.upsert(
      agentId,
      // D5：schema 宽松收包，类型收窄只是把 Record 视作 AgentDefinition，
      // 字段级校验完全交 upsert → validateAgentDefinition。
      definition as unknown as AgentDefinition,
      buildValidateOptions(agentsCtx),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ToolError(
      error instanceof AgentConfigError ? "INVALID_ARGUMENT" : "FAILED",
      `agent 定义保存未通过校验：${reason}`,
      { toolName: AGENT_TOOL_NAME, cause: error },
    );
  }
}

/**
 * 静态 `agent` 工具实例。
 *
 * 是否对 LLM 可见由 `resolveAgentToolRegistry` 控制：子 / 孙 agent 与
 * 摘 `task` 的同一分支一并摘除（D6），闭包不注入；主 agent（depth=0）
 * 默认可见（除非用户 policy 显式 deny）。
 */
export const agentTool: Tool<AgentToolInput, AgentToolOutput, BuiltinToolContext> =
  {
    name: AGENT_TOOL_NAME,
    description: (ctx) => {
      const agents = ctx.agents?.agents ?? [];
      return `管理 agent 定义（list / get / create / update）：可配置智能体（提示词布局 + 模型 pin + 工具策略），可在 task 工具中作为子代理调用。

当前可管理 agent 名单（装配期快照，回合内变更不即时反映）：
${formatAgentEntries(agents)}

action 一览：list 列清单 / get 查完整定义（name 或 agentId 定位，name 优先）/ create 新建（definition 必填，agentId 自动生成）/ update 整体覆盖更新（定位同 get + definition 必填）。

配置字段详情与完整示例请先 skill load agent-config。

注意：无删除动作（删除走用户界面 agent 管理）；定义保存后下一次会话生效。`;
    },
    inputSchema: z.object({
      action: z
        .enum(["list", "get", "create", "update"])
        .describe("动作类型：list 列清单 / get 查定义 / create 新建 / update 更新"),
      name: z
        .string()
        .min(1)
        .optional()
        .describe("agent 名称（get/update 定位用，优先于 agentId；可命中内置 general）"),
      agentId: z
        .string()
        .min(1)
        .optional()
        .describe("agent 持久化 id（get/update 定位用；create 时由工具生成，无需提供）"),
      definition: z
        .object({})
        .passthrough()
        .optional()
        .describe(
          "create/update 必填：完整定义体对象，语义校验由服务层完成，字段详情先 skill load agent-config",
        ),
    }),
    outputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("list"),
        entries: z.array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            mode: z.enum(["primary", "subagent", "all"]),
          }),
        ),
        total: z.number().int(),
        truncated: z.boolean().optional(),
      }),
      z.object({
        action: z.literal("get"),
        agentId: z.string().optional(),
        definition: z.custom<AgentDefinition>(
          (v) => typeof v === "object" && v !== null,
          { message: "definition 必须为对象" },
        ),
      }),
      z.object({
        action: z.literal("create"),
        name: z.string(),
        agentId: z.string(),
        message: z.string(),
      }),
      z.object({
        action: z.literal("update"),
        name: z.string(),
        agentId: z.string(),
        message: z.string(),
      }),
    ]),
    async run(input, ctx): Promise<AgentToolOutput> {
      const agentsCtx = ctx.agents;
      if (agentsCtx == null) {
        throw new ToolError(
          "FAILED",
          "agent 工具未装配 agents 上下文（当前 agent 不允许管理 agent 定义）",
          { toolName: AGENT_TOOL_NAME },
        );
      }

      switch (input.action) {
        case "list": {
          // 快照直出（无 IO）；条数 + 字节预算截断走 capMatchList。
          const capped = capMatchList(
            agentsCtx.agents,
            TOOL_OUTPUT_MAX_MATCHES,
            (e) => JSON.stringify(e),
          );
          return {
            action: "list",
            entries: capped.items.map((e) => ({
              name: e.name,
              ...(e.description != null ? { description: e.description } : {}),
              mode: e.mode,
            })),
            total: capped.total,
            ...(capped.truncated ? { truncated: true } : {}),
          };
        }
        case "get": {
          if (
            (input.name == null || input.name.length === 0) &&
            (input.agentId == null || input.agentId.length === 0)
          ) {
            throw new ToolError(
              "INVALID_ARGUMENT",
              "agent 的 get 动作必须提供 name 或 agentId",
              { toolName: AGENT_TOOL_NAME },
            );
          }
          // name 优先：registry.list() 合并虚拟 seed，by-name 可命中内置 general。
          if (input.name != null && input.name.length > 0) {
            const defs = await agentsCtx.registry.list();
            // 输入侧 trim 后再匹配（对齐 update，指南正文承诺两侧 trim）。
            const targetName = input.name.trim();
            const def = defs.find((d) => d.name === targetName);
            if (def == null) {
              const names = agentsCtx.agents.map((a) => a.name).join(", ");
              throw new ToolError(
                "FAILED",
                `未找到名为 "${targetName}" 的 agent；可选：${names || "（暂无）"}`,
                { toolName: AGENT_TOOL_NAME },
              );
            }
            return { action: "get", definition: def };
          }
          // by-agentId：get(id) 不合并虚拟；getRawWire 判存在（null → 未找到）。
          const agentId = requireString("get", "agentId", input.agentId);
          const wire = await agentsCtx.registry.getRawWire(agentId);
          if (wire == null) {
            throw new ToolError(
              "FAILED",
              `未找到 id 为 ${agentId} 的 agent`,
              { toolName: AGENT_TOOL_NAME },
            );
          }
          const def = await agentsCtx.registry.get(agentId);
          return { action: "get", agentId, definition: def };
        }
        case "create": {
          const definition = requireDefinition("create", input.definition);
          const agentId = await allocateAgentId(agentsCtx.registry);
          await upsertWithTranslatedError(agentsCtx, agentId, definition);
          return {
            action: "create",
            name: readDefinitionName(definition),
            agentId,
            message: AGENT_SAVED_MESSAGE,
          };
        }
        case "update": {
          const definition = requireDefinition("update", input.definition);
          const hasName = input.name != null && input.name.trim().length > 0;
          const hasId = input.agentId != null && input.agentId.length > 0;
          if (!hasName && !hasId) {
            throw new ToolError(
              "INVALID_ARGUMENT",
              "agent 的 update 动作必须提供 name 或 agentId 定位目标",
              { toolName: AGENT_TOOL_NAME },
            );
          }
          let agentId: string;
          if (hasName) {
            // name 优先（与 get 一致）：解析持久化 id；虚拟 general 无 id 单独报错。
            const targetName = input.name!.trim();
            const resolved = await findAgentIdByName(
              agentsCtx.registry,
              targetName,
            );
            if (resolved == null) {
              if (agentsCtx.agents.some((a) => a.name === targetName)) {
                throw new ToolError(
                  "FAILED",
                  `"${targetName}" 是内置 agent，不支持通过工具修改`,
                  { toolName: AGENT_TOOL_NAME },
                );
              }
              throw new ToolError(
                "FAILED",
                `未找到名为 "${targetName}" 的 agent`,
                { toolName: AGENT_TOOL_NAME },
              );
            }
            agentId = resolved;
          } else {
            agentId = input.agentId!;
            // 过期/拼错的 id 不应静默当作 create 语义落盘：先判存在
            //（对齐 get by-agentId 的 getRawWire 判空样板）。
            const wire = await agentsCtx.registry.getRawWire(agentId);
            if (wire == null) {
              throw new ToolError(
                "INVALID_ARGUMENT",
                `未找到该 agentId 对应的 agent：${agentId}`,
                { toolName: AGENT_TOOL_NAME },
              );
            }
          }
          await upsertWithTranslatedError(agentsCtx, agentId, definition);
          return {
            action: "update",
            name: readDefinitionName(definition),
            agentId,
            message: AGENT_SAVED_MESSAGE,
          };
        }
      }
    },
  };
