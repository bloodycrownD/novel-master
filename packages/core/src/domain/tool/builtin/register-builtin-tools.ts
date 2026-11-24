/**
 * Registers V2 builtin workspace file tools + 静态 task / skill / agent /
 * curl / search 工具 + 装配期 MCP 工具快照注册。
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
   * `search` 工具（共 11 个）。
   *
   * task / skill / agent 是静态对象，description 是 lambda，装配期由
   * `toolsFromRegistry` 分别读 `ctx.subagent.callableAgents` /
   * `ctx.skills.effective` / `ctx.agents.agents` 求值。task 是否对 LLM
   * 可见由 `AgentTools.resolveRegistry` 的 depth 判断控制（孙 agent depth>=2 deny）；
   * agent 与 task 同分支摘除（子/孙 agent 不可管理 agent，D6）；skill 由
   * tools.allow/deny 与技能总开关控制（与 task 同机制，无静态白名单）；
   * curl / search 不在任何摘除分支内，主/子/孙 agent 全深度可用，网络入口
   * 经 `ctx.fetchFn` 可选注入（缺省 globalThis.fetch）；search 另读
   * `ctx.search` 闭包解析引擎（未装配时 run 返回可读错误）。
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
    },

    /**
   * 注册 MCP 工具快照（spec §六 / Step 9）：条目经 `McpToolAdapter.toNmTool`
   * 转成 `mcp__<server>__<tool>` 工具（description 同步取快照、inputSchema
   * 宽松接收），调用通道闭包 `connectionManager.callTool`（serverId 由本处
   * 绑定，MCP 侧原始工具名留到 run 透传）。
   *
   * 注册前按 slug 复合名检查同一快照内的重名：撞名的 server 命名空间已污染，
   * 其**全部**工具都不注册（`ToolRegistry.register` 重名走 assert，先过滤才
   * 不会炸掉整轮装配），涉事 server 打 warn 留排查线索。
   */
  // nm-style: keep-public — spec 变更点清单指定本文件承接 registerMcpTools（与 register 同族的注册编排）；slug 冲突检测认识 ToolRegistry 与快照模型，内联会把 tool 域逻辑上移进 service 层。
    registerMcpTools(registry: ToolRegistry<BuiltinToolContext>, snapshot: readonly McpToolSnapshot[], connectionManager: McpConnectionManager): void {
        const byName = new Map<string, readonly McpToolSnapshot[]>();
        for (const entry of snapshot) {
            const name = McpToolSlug.toolName(entry.serverId, entry.toolName);
            byName.set(name, [...(byName.get(name) ?? []), entry]);
        }
        const conflictingServers = new Set([...byName.values()].flatMap((group) => (group.length > 1 ? group.map((entry) => entry.serverId) : [])));
        for (const entry of snapshot) {
            if (conflictingServers.has(entry.serverId)) continue;
            registry.register(McpToolAdapter.toNmTool(entry, {call: (toolName, args, signal) => connectionManager.callTool(entry.serverId, toolName, args, signal)}));
        }
        if (conflictingServers.size > 0) log.warn("MCP 工具名冲突，涉事 server 的工具本轮未注册", {servers: [...conflictingServers].sort()});
    },
} as const;
