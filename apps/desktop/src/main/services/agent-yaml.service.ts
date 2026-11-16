/**
 * Agent YAML import/export via Electron dialog.
 *
 * @module services/agent-yaml
 */
import { decode, encode, parseText, registerBuiltinTools, stringifyText, ToolRegistry } from "@novel-master/core";

import { agentDefinitionSchema, validateAgentDefinition, type AgentDefinition, type AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";
import type { BrowserWindow } from "electron";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import { exportYamlWithDialog, importYamlWithDialog, normalizeYamlError } from "./yaml-shared.js";

export function decodeAgentYamlText(yaml: string): Result<AgentDefinition, AppError> {
  // 错误通道迁移七期：parseText / decode 沿 Result 原样接力，不再解包抛错；
  // 对话框 consume 回调（yaml-shared，Promise<void>，只有 throw 通道）在唯一
  // 调用处经 normalizeYamlError 贴标签还原抛错契约。
  const parsed = parseText(yaml, "yaml");
  if (!parsed.ok) return Result.err(parsed.error);
  const decoded = decode(parsed.value, agentDefinitionSchema);
  if (!decoded.ok) return Result.err(decoded.error);
  return Result.ok(decoded.value);
}

export function encodeAgentYamlText(def: AgentDefinition): string {
  const doc = encode(def, agentDefinitionSchema);
  return stringifyText(doc, "yaml");
}

export async function exportAgentYamlWithDialog(runtime: DesktopNovelMasterRuntime, agentId: string, parentWindow?: BrowserWindow | null): Promise<"saved" | "cancelled"> {
  const def = await runtime.agentRegistry.get(agentId);
  if (!def.ok) {
    // 导出对话框回调无 Result 通道：registry 已知失败转 throw，由对话框调用方 catch 收口。
    const failure = def.error;
    throw failure;
  }
  const yaml = encodeAgentYamlText(def.value);
  return exportYamlWithDialog(yaml, `${agentId}.agent.yaml`, parentWindow);
}

export async function importAgentYamlWithDialog(runtime: DesktopNovelMasterRuntime, agentId: string, parentWindow?: BrowserWindow | null): Promise<"imported" | "cancelled"> {
  return importYamlWithDialog(async (yaml) => {
    try {
      const defR = decodeAgentYamlText(yaml);
      // consume 回调协议只有 throw 通道（yaml-shared，Promise<void>）：已知失败
      // 过 normalizeYamlError 贴标签后抛出（错误通道迁移七期边界保留点）；
      // 外层 catch 见到已带前缀的产物原样放行，避免二次套前缀。
      if (!defR.ok) throw normalizeYamlError(defR.error, "Agent YAML 无效");
      const def = defR.value;
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      const validation = await validateAgentDefinition(def, { registeredToolNames: probe.list() });
      if (!validation.ok) {
        // consume 回调协议只有 throw 通道（yaml-shared，Promise<void>）：已知失败
        // 在此直接过 normalizeYamlError 转码后抛出（错误通道迁移四期，边界保留点）；
        // 外层 catch 见到已带「Agent YAML 无效」前缀的产物原样放行，避免二次套前缀。
        throw normalizeYamlError(validation.error, "Agent YAML 无效");
      }
      const saved = await runtime.agentRegistry.upsert(agentId, def, { registeredToolNames: probe.list() });
      if (!saved.ok) {
        // consume 回调协议只有 throw 通道（yaml-shared，Promise<void>）：已知失败
        // 在此过 normalizeYamlError 转码后抛出（错误通道迁移四期，边界保留点）。
        throw normalizeYamlError(saved.error, "Agent YAML 无效");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Agent YAML 无效")) {
        throw error;
      }
      throw normalizeYamlError(error, "Agent YAML 无效");
    }
  }, parentWindow);
}
