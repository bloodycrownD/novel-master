/**
 * Agent registry CRUD IPC handlers.
 */
import { registerBuiltinTools, ToolRegistry, type TdbcConnection } from "@novel-master/core";
import {
  allocateAgentDisplayName,
  createDefaultAgentEditorPrompts,
  layoutFromFormInput,
} from "@novel-master/core/config-forms/agent";
import { assessAgentDefinitionWire } from "@novel-master/core/config-forms/stored-config-validity";
import type {
  AgentRegistryCreateBlankRequest,
  AgentRegistryDeleteRequest,
  AgentRegistryGetRequest,
  AgentRegistryGetResponse,
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
import { toStoredConfigHealthDto } from "./stored-config-health-dto.js";
import { BrowserWindow } from "electron";

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow();
}

/** 从库读取智能体原始 wire（不解码）。 */
async function getAgentRawWire(
  conn: TdbcConnection,
  agentId: string,
): Promise<unknown | null> {
  const rows = await conn.query<{ prompts_json: string }>(
    `SELECT prompts_json FROM agent_definition WHERE agent_id = ?`,
    [agentId],
  );
  if (rows.length === 0) {
    return null;
  }
  return JSON.parse(String(rows[0]!.prompts_json)) as unknown;
}

/** 从 wire 尽力读取显示名称。 */
function readAgentNameFromWire(raw: unknown, fallback: string): string {
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const name = (raw as Record<string, unknown>).name;
    if (typeof name === "string") {
      const trimmed = name.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return fallback;
}

export async function handleAgentRegistryList(): Promise<
  IpcResult<AgentRegistryListItemDto[]>
> {
  try {
    const rt = await getDesktopRuntime();
    const ids = await rt.agentRegistry.listAgentIds();
    const rows: AgentRegistryListItemDto[] = [];
    for (const agentId of ids) {
      const raw = await getAgentRawWire(rt.conn, agentId);
      if (raw == null) {
        continue;
      }
      const health = assessAgentDefinitionWire(raw);
      const name =
        health.status === "valid"
          ? health.value.name?.trim() || agentId
          : readAgentNameFromWire(raw, agentId);
      if (health.status === "invalid") {
        rows.push({
          agentId,
          name,
          invalid: {
            code: health.code,
            message: health.message,
            ...(health.storedSchemaVersion != null
              ? { storedSchemaVersion: health.storedSchemaVersion }
              : {}),
          },
          decodeError: health.message,
        });
      } else {
        // valid 行从定义带出 mode；缺省时不写字段（JSON 序列化天然丢弃），
        // 保持「未填写 = 双边显示」语义；invalid 行走上面分支，天然无 mode。
        rows.push({
          agentId,
          name,
          ...(health.value.mode != null
            ? { mode: health.value.mode }
            : {}),
        });
      }
    }
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentRegistryGet(
  req: AgentRegistryGetRequest,
): Promise<IpcResult<AgentRegistryGetResponse>> {
  try {
    const rt = await getDesktopRuntime();
    const raw = await getAgentRawWire(rt.conn, req.agentId);
    if (raw == null) {
      return {
        ok: false,
        error: {
          code: "AGENT_NOT_FOUND",
          message: `agent not found: ${req.agentId}`,
        },
      };
    }
    const health = toStoredConfigHealthDto(assessAgentDefinitionWire(raw));
    return { ok: true, data: { ...health, wire: raw } };
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
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: formatIpcError(err) };
  }
}

export async function handleAgentRegistryCreateBlank(
  req?: AgentRegistryCreateBlankRequest,
): Promise<IpcResult<{ agentId: string }>> {
  try {
    const rt = await getDesktopRuntime();
    const agentId = `agent-${Date.now()}`;
    const probe = new ToolRegistry();
    registerBuiltinTools(probe);
    const defaultPrompts = createDefaultAgentEditorPrompts();
    const slots = [];
    for (const id of await rt.agentRegistry.listAgentIds()) {
      const raw = await getAgentRawWire(rt.conn, id);
      if (raw == null) {
        slots.push({ id, name: id });
        continue;
      }
      const health = assessAgentDefinitionWire(raw);
      const name =
        health.status === "valid"
          ? health.value.name
          : readAgentNameFromWire(raw, id);
      slots.push({ id, name });
    }
    const name = allocateAgentDisplayName(slots);
    await rt.agentRegistry.upsert(
      agentId,
      {
        name,
        // 可选作用域随 tab 落库；请求体缺省 / undefined 时容忍（= 现行为不设 mode）。
        ...(req?.mode != null ? { mode: req.mode } : {}),
        runtime: { maxSteps: 20 },
        prompts: layoutFromFormInput(defaultPrompts),
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
