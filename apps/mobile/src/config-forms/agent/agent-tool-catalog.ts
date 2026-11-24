import type {AgentDefinition, AgentToolPolicy} from '@novel-master/core/agent';
import {coreT} from '@/i18n/core';
import type {ToolsMode} from './agent-editor-state';

/** catalog 单条目；placeholder 条目只作提示展示，不参与勾选与计数。 */
export interface AgentToolCatalogEntry {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly placeholder?: boolean;
}

/** catalog 分组：builtin 静态硬编码；mcp 由 deps.mcpTools() 动态组装（spec §九）。 */
export interface AgentToolCatalogGroup {
    readonly id: 'builtin' | 'mcp';
    readonly entries: readonly AgentToolCatalogEntry[];
}

/** deps.mcpTools() 的条目形态：core `McpToolSnapshot` 的窄视图 + 注册进 registry 的最终名。 */
export interface AgentToolCatalogMcpTool {
    /** `McpToolSlug.toolName(serverId, toolName)` 的结果（`mcp__<server>__<tool>`，含截断短哈希）。 */
    readonly registeredName: string;
    /** 展示名（description 前缀用）。 */
    readonly serverName: string;
    /** 工具描述；缺省回落 registeredName。 */
    readonly toolDescription?: string;
}

export interface AgentToolCatalogDeps {
    /** 页面打开时刻的 MCP 工具快照（同步读缓存；空数组 = 无可用 server）。 */
    mcpTools(): readonly AgentToolCatalogMcpTool[];
}

/** Catalog of V2 builtin tools for Agent policy UI（与 registerBuiltinTools 同步）。 */
export const BUILTIN_TOOL_CATALOG: ReadonlyArray<AgentToolCatalogEntry> = [
    {
        name: 'task',
        label: 'task',
        description: coreT({key: "ui.agent.tool_desc_task"}),
    },
    {name: 'read', label: 'read', description: coreT({key: "ui.agent.tool_desc_read"})},
    {name: 'write', label: 'write', description: coreT({key: "ui.agent.tool_desc_write"})},
    {name: 'edit', label: 'edit', description: coreT({key: "ui.agent.tool_desc_edit"})},
    {
        name: 'fs',
        label: 'fs',
        description: coreT({key: "ui.agent.tool_desc_fs"}),
    },
    {name: 'glob', label: 'glob', description: coreT({key: "ui.agent.tool_desc_glob"})},
    {
        name: 'grep',
        label: 'grep',
        description: coreT({key: "ui.agent.tool_desc_grep"}),
    },
    {
        name: 'skill',
        label: 'skill',
        description: coreT({key: "ui.agent.tool_desc_skill"}),
    },
    {
        name: 'agent',
        label: 'agent',
        description: coreT({key: "ui.agent.tool_desc_agent"}),
    },
    {
        name: 'curl',
        label: 'curl',
        description: coreT({key: "ui.agent.tool_desc_curl"}),
    },
    {
        name: 'search',
        label: 'search',
        description: coreT({key: "ui.agent.tool_desc_search"}),
    },
] as const;

export const AgentToolCatalog = {
    /** 取数入口：静态分组照旧硬编码，mcp 分组按快照动态组装；空快照回落「未配置 MCP 服务器」单项提示。 */
    get: (deps: AgentToolCatalogDeps): readonly AgentToolCatalogGroup[] => {
        const tools = deps.mcpTools();
        const mcpEntries: readonly AgentToolCatalogEntry[] = tools.length === 0
            ? [{name: 'mcp', label: 'mcp', description: coreT({key: "ui.agent.mcp_not_configured"}), placeholder: true}]
            : tools.map(tool => ({
                name: tool.registeredName,
                label: tool.registeredName,
                description: `[MCP:${tool.serverName}] ${tool.toolDescription ?? tool.registeredName}`,
            }));
        return [
            {id: 'builtin', entries: BUILTIN_TOOL_CATALOG},
            {id: 'mcp', entries: mcpEntries},
        ];
    },

    // prettier-ignore
    buildToolsPolicyFromSelection: (mode: ToolsMode, selected: readonly string[]): AgentToolPolicy | undefined => {
        if (mode === 'default') {
            return undefined;
        }
        const names = [...selected];
        if (mode === 'allow') {
            return {allow: names};
        }
        return {deny: names};
    },

    toolsSelectionFromDefinition: (def: AgentDefinition): {
        mode: ToolsMode;
        selected: readonly string[];
    } => {
        if (def.tools?.allow != null) {
            return {mode: 'allow', selected: [...def.tools.allow]};
        }
        if (def.tools?.deny != null) {
            return {mode: 'deny', selected: [...def.tools.deny]};
        }
        return {mode: 'default', selected: []};
    },
} as const;
