/**
 * Agent registry CRUD IPC handlers.
 */
import { BuiltinTools, ToolRegistry } from "@novel-master/core";
import { AgentDefinitionValidator, AgentYamlCodec } from "@novel-master/core/agent";
import { Errors } from "@novel-master/core/common";
import { Result } from "@novel-master/core/errors";
import type { TdbcConnection } from "@novel-master/core";
import * as configForms from "../../../../shared/config-forms/agent.js";
import { AgentDefinitionWire } from "@novel-master/core/stored-config-validity";
import type {
  AgentRegistryCreateBlankRequest,
  AgentRegistryDeleteRequest,
  AgentRegistryGetRequest,
  AgentRegistryGetResponse,
  AgentRegistryListItemDto,
  AgentRegistryUpdateRequest,
  AgentRegistryUpsertRequest,
  AgentYamlExportRequest,
  AgentYamlImportRequest,
  IpcResult,
} from "../../../../shared/ipc-types.js";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { YamlShared } from "../../services/yaml-shared.js";
import { FormatIpcError } from "../ipc-error.js";
import { IpcResults } from "../ipc-result.js";
import { StoredConfigHealthMapper } from "./stored-config-health-dto.js";
import { BrowserWindow } from "electron";

export namespace AgentRegistry {
  /** 从库读取智能体原始 wire（不解码）。 */
  async function getRawWire(conn: TdbcConnection, agentId: string) {
    const sql = `SELECT prompts_json FROM agent_definition WHERE agent_id = ?`;
    const rows = await conn.query<{ prompts_json: string }>(sql, [agentId]);
    if (rows.length === 0) {
      return null;
    }
    return JSON.parse(String(rows[0]!.prompts_json)) as unknown;
  }

  /** 从 wire 尽力读取显示名称。 */
  function readNameFromWire(raw: unknown, fallback: string): string {
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

  export async function list(): Promise<IpcResult<AgentRegistryListItemDto[]>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const ids = await rt.agentRegistry.listAgentIds();
      const rows: AgentRegistryListItemDto[] = [];
      for (const agentId of ids) {
        const raw = await getRawWire(rt.conn, agentId);
        if (raw == null) {
          continue;
        }
        const health = AgentDefinitionWire.assess(raw);
        const fallback = readNameFromWire(raw, agentId);
        const valid = health.status === "valid";
        const name = valid ? health.value.name?.trim() || agentId : fallback;
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
            ...(health.value.mode != null ? { mode: health.value.mode } : {}),
          });
        }
      }
      return { ok: true, data: rows };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function get(req: AgentRegistryGetRequest): Promise<IpcResult<AgentRegistryGetResponse>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const raw = await getRawWire(rt.conn, req.agentId);
      if (raw == null) {
        return {
          ok: false,
          error: {
            code: "AGENT_NOT_FOUND",
            message: `agent not found: ${req.agentId}`,
          },
        };
      }
      const health = StoredConfigHealthMapper.toDto(AgentDefinitionWire.assess(raw));
      return { ok: true, data: { ...health, wire: raw } };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function upsert(req: AgentRegistryUpsertRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const probe = new ToolRegistry();
      BuiltinTools.register(probe);
      const def = req.definition as Parameters<typeof rt.agentRegistry.upsert>[1];
      const opts = { registeredToolNames: probe.list() };
      return IpcResults.from(await rt.agentRegistry.upsert(req.agentId, def, opts));
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function update(req: AgentRegistryUpdateRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const probe = new ToolRegistry();
      BuiltinTools.register(probe);
      const patch = req.patch as Parameters<typeof rt.agentRegistry.update>[1];
      const opts = { registeredToolNames: probe.list() };
      const updated = await rt.agentRegistry.update(req.agentId, patch, opts);
      if (!updated.ok) return IpcResults.err(FormatIpcError.format(updated.error));
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function remove(req: AgentRegistryDeleteRequest): Promise<IpcResult<void>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const deleted = await rt.agentRegistry.delete(req.agentId);
      if (!deleted.ok) return IpcResults.err(FormatIpcError.format(deleted.error));
      return { ok: true, data: undefined };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function createBlank(req?: AgentRegistryCreateBlankRequest): Promise<IpcResult<{ agentId: string }>> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const agentId = `agent-${Date.now()}`;
      const probe = new ToolRegistry();
      BuiltinTools.register(probe);
      const defaultPrompts = configForms.createDefaultAgentEditorPrompts();
      const slots = [];
      for (const id of await rt.agentRegistry.listAgentIds()) {
        const raw = await getRawWire(rt.conn, id);
        if (raw == null) {
          slots.push({ id, name: id });
          continue;
        }
        const health = AgentDefinitionWire.assess(raw);
        const fallback = readNameFromWire(raw, id);
        const name = health.status === "valid" ? health.value.name : fallback;
        slots.push({ id, name });
      }
      const name = configForms.allocateAgentDisplayName(slots);
      const definition = {
        name,
        // 可选作用域随 tab 落库；请求体缺省 / undefined 时容忍（= 现行为不设 mode）。
        ...(req?.mode != null ? { mode: req.mode } : {}),
        runtime: { maxSteps: 20 },
        prompts: configForms.layoutFromFormInput(defaultPrompts),
      };
      const opts = { registeredToolNames: probe.list() };
      const saved = await rt.agentRegistry.upsert(agentId, definition, opts);
      if (!saved.ok) return { ok: false, error: FormatIpcError.format(saved.error) };
      return { ok: true, data: { agentId } };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function exportYaml(req: AgentYamlExportRequest): Promise<IpcResult<"saved" | "cancelled">> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      const def = await rt.agentRegistry.get(req.agentId);
      // registry 已知失败就地短路（与本 handler 上方 built 短路同款），未知异常仍由 catch 兜。
      if (!def.ok) return { ok: false, error: FormatIpcError.format(def.error) };
      const yaml = AgentYamlCodec.encode(def.value);
      const result = await YamlShared.exportWithDialog(yaml, `${req.agentId}.agent.yaml`, BrowserWindow.getFocusedWindow());
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }

  export async function importYaml(req: AgentYamlImportRequest): Promise<IpcResult<"imported" | "cancelled">> {
    try {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return { ok: false, error: FormatIpcError.format(built.error) };
      const rt = built.value;
      // 原 importAgentYamlWithDialog 内联：consume 回调与 mobile 同通道（Result），
      // 已知失败过 Errors.normalizeYaml 贴标签回传。
      // nm-style: keep-local — 具名回调是 importYamlWithDialog 多行实参拆 VARDECL 的唯一出路；内联回调用点会让 consume 回调与窗口实参跨行（check-signatures ARGS），规则互斥（同 llm-sse-transport 先例）。
      const importAgentFromYaml = async (yaml: string) => {
        try {
          const defR = AgentYamlCodec.decode(yaml);
          if (!defR.ok) return Result.err(Errors.normalizeYaml(defR.error, "Agent YAML 无效"));
          const def = defR.value;
          const probe = new ToolRegistry();
          BuiltinTools.register(probe);
          const validation = await AgentDefinitionValidator.validate(def, { registeredToolNames: probe.list() });
          if (!validation.ok) return Result.err(Errors.normalizeYaml(validation.error, "Agent YAML 无效"));
          const saved = await rt.agentRegistry.upsert(req.agentId, def, { registeredToolNames: probe.list() });
          if (!saved.ok) return Result.err(Errors.normalizeYaml(saved.error, "Agent YAML 无效"));
          return Result.ok(undefined);
        } catch (error) {
          // registry/校验链的意外抛出同样贴标签后走 Result；已贴标签的产物不会二次进入本分支
          // （本回调不再 throw 已知失败），故无需旧的「前缀已存在则放行」守卫。
          return Result.err(Errors.normalizeYaml(error, "Agent YAML 无效"));
        }
      };
      const win = BrowserWindow.getFocusedWindow();
      const result = await YamlShared.importWithDialog(importAgentFromYaml, win);
      // import 通道与 mobile 一致走 Result：已知失败就地转码，未知异常仍由 catch 兜。
      if (!result.ok) return { ok: false, error: FormatIpcError.format(result.error) };
      return { ok: true, data: result.value };
    } catch (err) {
      return { ok: false, error: FormatIpcError.format(err) };
    }
  }
}
