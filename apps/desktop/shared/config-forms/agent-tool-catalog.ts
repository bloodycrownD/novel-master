import type { AgentDefinition, AgentToolPolicy } from "@novel-master/core/agent";
import type { ToolsMode } from "./agent-editor-state.js";
import { coreT } from "../logic/core-i18n.js";

/** catalog 单条目。 */
export interface AgentToolCatalogEntry {
    readonly name: string;
    readonly label: string;
    readonly description: string;
}

/** Catalog of V2 builtin tools for Agent policy UI（与 BuiltinTools.register 同步，含 mcp 占位工具）。 */
export const BUILTIN_TOOL_CATALOG: ReadonlyArray<AgentToolCatalogEntry> = [
    {
        name: "task",
        label: "task",
        description: coreT({key: "ui.agent.tool_desc_task"}),
    },
    { name: "read", label: "read", description: coreT({key: "ui.agent.tool_desc_read"}) },
    { name: "write", label: "write", description: coreT({key: "ui.agent.tool_desc_write"}) },
    { name: "edit", label: "edit", description: coreT({key: "ui.agent.tool_desc_edit"}) },
    {
        name: "fs",
        label: "fs",
        description: coreT({key: "ui.agent.tool_desc_fs"}),
    },
    { name: "glob", label: "glob", description: coreT({key: "ui.agent.tool_desc_glob"}) },
    {
        name: "grep",
        label: "grep",
        description: coreT({key: "ui.agent.tool_desc_grep"}),
    },
    {
        name: "skill",
        label: "skill",
        description: coreT({key: "ui.agent.tool_desc_skill"}),
    },
    {
        name: "agent",
        label: "agent",
        description: coreT({key: "ui.agent.tool_desc_agent"}),
    },
    {
        name: "curl",
        label: "curl",
        description: coreT({key: "ui.agent.tool_desc_curl"}),
    },
    {
        name: "search",
        label: "search",
        description: coreT({key: "ui.agent.tool_desc_search"}),
    },
    {
        name: "mcp",
        label: "mcp",
        description: coreT({key: "ui.agent.tool_desc_mcp"}),
    },
] as const;

export const AgentToolCatalog = {
    buildToolsPolicyFromSelection: (mode: ToolsMode, selected: readonly string[]): AgentToolPolicy | undefined => {
        if (mode === "default") {
            return undefined;
        }
        const names = [...selected];
        if (mode === "allow") {
            return { allow: names };
        }
        return { deny: names };
    },

    toolsSelectionFromDefinition: (def: AgentDefinition): {
        mode: ToolsMode;
        selected: readonly string[];
    } => {
        if (def.tools?.allow != null) {
            return { mode: "allow", selected: [...def.tools.allow] };
        }
        if (def.tools?.deny != null) {
            return { mode: "deny", selected: [...def.tools.deny] };
        }
        return { mode: "default", selected: [] };
    },
} as const;
