/**
 * Registers V2 builtin workspace file tools + 静态 task / skill / agent /
 * curl / search 工具 + `mcp` 占位（策略层的「MCP」一项，spec §D）+ 装配期
 * MCP 工具快照注册。占位随 `register` 进册（保存校验与名单筛选把 `mcp`
 * 当已知名）；`registerMcpTools` 在名单筛选**之后**由 run-agent-turn 调用，
 * 注销占位并换上实际的 `mcp__` 工具。
 *
 * @module domain/tool/builtin/register-builtin-tools
 */

import {McpToolSlug} from "@/domain/mcp/logic/slugify-mcp-tool-name.js";
import {McpToolAdapter} from "@/domain/mcp/logic/to-nm-tool.js";
import type {McpToolSnapshot} from "@/domain/mcp/model/mcp-tool-snapshot.js";
import type {McpConnectionManager} from "@/domain/mcp/ports/mcp-connection.port.js";
import {LogFactory} from "@/infra/log/logger.js";
import type {ToolRegistry} from "../logic/tool-registry.js";
import type {BuiltinToolContext} from "./builtin-tool-context.js";
import {FileTools} from "./vfs-tools.js";
import {subagentTool} from "./subagent-tool.js";
import {skillTool} from "./skill-tool.js";
import {agentTool} from "./agent-tool.js";
import {curlTool} from "./curl-tool.js";
import {searchTool} from "./search/search-tool.js";

const log = LogFactory.create("tool.mcp");

export const BuiltinTools = {
    /**
   * 注册内置工具：6 个 vfs 工具 + 静态 `task` / `skill` / `agent` / `curl` /
   * `search` 工具 + `mcp` 占位（共 12 个）。
   *
   * task / skill / agent 是静态对象，description 是 lambda，装配期由
   * `ToolDefinitions.fromRegistry` 分别读 `ctx.subagent.callableAgents` /
   * `ctx.skills.effective` / `ctx.agents.agents` 求值。task 是否对 LLM
   * 可见由 `AgentTools.resolveRegistry` 的 depth 判断控制（孙 agent depth>=2 deny）；
   * agent 与 task 同分支摘除（子/孙 agent 不可管理 agent，D6）；skill 由
   * tools.allow/deny 与技能总开关控制（与 task 同机制，无静态白名单）；
   * curl / search 不在任何摘除分支内，主/子/孙 agent 全深度可用，网络入口
   * 经 `ctx.fetchFn` 可选注入（缺省 globalThis.fetch）；search 另读
   * `ctx.search` 闭包解析引擎（未装配时 run 返回可读错误）。
   *
   * `mcp` 占位（`McpToolAdapter.groupTool()`）与其他工具平等地参与名单筛选
   * 与保存校验；它唯一的出口是 `registerMcpTools` 的注销与替换，永远到不了
   * 模型（run-agent-turn 在筛选后调用）。
   */
    register(registry: ToolRegistry<BuiltinToolContext>): void {
        for (const tool of FileTools.create()) {
            registry.register(tool);
        }
        registry.register(subagentTool);
        registry.register(skillTool);
        registry.register(agentTool);
        registry.register(curlTool);
        registry.register(searchTool);
        registry.register(McpToolAdapter.groupTool());
    },

    /**
   * 占位替换（spec §六 / §D / Step 9）：注销占位 `mcp`，把快照条目经
   * `McpToolAdapter.toNmTool` 转成 `mcp__<server>__<tool>` 工具注册（description
   * 同步取快照、inputSchema 宽松接收），调用通道闭包 `connectionManager.callTool`
   * （serverId 由本处绑定，MCP 侧原始工具名留到 run 透传）。
   *
   * 占位**无条件注销**：没有可替换的工具（缓存为空）时同样注销——占位不能
   * 因为没有东西可替换就留在注册表里。调用时机在名单筛选之后（run-agent-turn），
   * 筛掉占位的智能体不会走到这里。
   *
   * 同名只注册第一个：真正的撞名判定在连接管理器读取缓存时做（cachedTools
   * 不返回撞名工具），本处只是不让重复名走到 `ToolRegistry.register` 的断言上
   * 的最后防线；被跳过的重复名打 warn 留排查线索。
   */
  // nm-style: keep-public — spec 变更点清单指定本文件承接 registerMcpTools（与 register 同族的注册编排）；占位注销与去重认识 ToolRegistry 与快照模型，内联会把 tool 域逻辑上移进 service 层。
    registerMcpTools(registry: ToolRegistry<BuiltinToolContext>, snapshot: readonly McpToolSnapshot[], connectionManager: McpConnectionManager): void {
        registry.unregister("mcp");
        const registered = new Set<string>();
        const duplicates: string[] = [];
        for (const entry of snapshot) {
            const name = McpToolSlug.toolName(entry.serverId, entry.toolName);
            if (registered.has(name)) {
                duplicates.push(name);
                continue;
            }
            registered.add(name);
            registry.register(McpToolAdapter.toNmTool(entry, {call: (toolName, args, signal) => connectionManager.callTool(entry.serverId, toolName, args, signal)}));
        }
        if (duplicates.length > 0) log.warn("重复的工具名只注册了第一个", {duplicates: duplicates.sort()});
    },
} as const;
