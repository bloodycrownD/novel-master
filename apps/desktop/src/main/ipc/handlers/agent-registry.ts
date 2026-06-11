/**
 * Agent registry CRUD IPC handlers.
 */
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import type {
  AgentRegistryDeleteRequest,
  AgentRegistryGetRequest,
  AgentRegistryListItemDto,
  AgentRegistryUpsertRequest,
  AgentYamlExportRequest,
  AgentYamlImportRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { getDesktopRuntime } from "../../runtime/desktop-runtime-singleton.js";
import {
  exportAgentYamlWithDialog,
  importAgentYamlWithDialog,
} from "../../services/agent-yaml.service.js";
import { formatIpcError } from "../ipc-error.js";
import { BrowserWindow } from "electron";

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

export async function handleAgentRegistryList(): Promise<
  IpcResult<AgentRegistryListItemDto[]>
> {
  try {
    const rt = await getDesktopRuntime();
    const ids = await rt.agentRegistry.listAgentIds();
    const rows: AgentRegistryListItemDto[] = [];
    for (const agentId of ids) {
      let name = agentId;
      try {
        const def = await rt.agentRegistry.get(agentId);
        name = def.name?.trim() || agentId;
      } catch {
        /* keep id */
      }
      rows.push({ agentId, name });
    }
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentRegistryGet(
  req: AgentRegistryGetRequest,
): Promise<IpcResult<unknown>> {
  try {
    const rt = await getDesktopRuntime();
    const def = await rt.agentRegistry.get(req.agentId);
    return { ok: true, data: def };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentRegistryUpsert(
  req: AgentRegistryUpsertRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    const probe = new ToolRegistry();
    registerBuiltinTools(probe);
    await rt.agentRegistry.upsert(req.agentId, req.definition as Parameters<
      typeof rt.agentRegistry.upsert
    >[1], {
      registeredToolNames: probe.list(),
    });
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentRegistryDelete(
  req: AgentRegistryDeleteRequest,
): Promise<IpcResult<void>> {
  try {
    const rt = await getDesktopRuntime();
    await rt.agentRegistry.delete(req.agentId);
    const currentId = await rt.state.getCurrentAgentId();
    if (currentId === req.agentId) {
      await rt.state.resetCurrentAgentId();
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentRegistryCreateBlank(): Promise<
  IpcResult<{ agentId: string }>
> {
  try {
    const rt = await getDesktopRuntime();
    const agentId = `agent-${Date.now()}`;
    const probe = new ToolRegistry();
    registerBuiltinTools(probe);
    await rt.agentRegistry.upsert(
      agentId,
      {
        name: "new-agent",
        runtime: { maxSteps: 20 },
        prompts: [
          { name: "system", type: "text", role: "system", content: "" },
          { name: "history", type: "chat" },
        ],
      },
      { registeredToolNames: probe.list() },
    );
    return { ok: true, data: { agentId } };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentYamlExport(
  req: AgentYamlExportRequest,
): Promise<IpcResult<"saved" | "cancelled">> {
  try {
    const rt = await getDesktopRuntime();
    const result = await exportAgentYamlWithDialog(
      rt,
      req.agentId,
      parentWindow(),
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentYamlImport(
  req: AgentYamlImportRequest,
): Promise<IpcResult<"imported" | "cancelled">> {
  try {
    const rt = await getDesktopRuntime();
    const result = await importAgentYamlWithDialog(
      rt,
      req.agentId,
      parentWindow(),
    );
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}
