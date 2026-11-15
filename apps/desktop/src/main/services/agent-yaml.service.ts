/**
 * Agent YAML import/export via Electron dialog.
 *
 * @module services/agent-yaml
 */
import { decode, encode, parseText, registerBuiltinTools, stringifyText, ToolRegistry } from "@novel-master/core";

import { agentDefinitionSchema, validateAgentDefinition, type AgentDefinition } from "@novel-master/core/agent";
import type { BrowserWindow } from "electron";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import {
  exportYamlWithDialog,
  importYamlWithDialog,
  normalizeYamlError,
} from "./yaml-shared.js";

export function decodeAgentYamlText(yaml: string): AgentDefinition {
  const raw = parseText(yaml, "yaml");
  return decode(raw, agentDefinitionSchema);
}

export function encodeAgentYamlText(def: AgentDefinition): string {
  const doc = encode(def, agentDefinitionSchema);
  return stringifyText(doc, "yaml");
}

export async function exportAgentYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
  agentId: string,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  const def = await runtime.agentRegistry.get(agentId);
  const yaml = encodeAgentYamlText(def);
  return exportYamlWithDialog(yaml, `${agentId}.agent.yaml`, parentWindow);
}

export async function importAgentYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
  agentId: string,
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  return importYamlWithDialog(async (yaml) => {
    try {
      const def = decodeAgentYamlText(yaml);
      const probe = new ToolRegistry();
      registerBuiltinTools(probe);
      const validation = await validateAgentDefinition(def, {registeredToolNames: probe.list()});
      if (!validation.ok) {
        // consume 回调协议只有 throw 通道（yaml-shared，Promise<void>）：已知失败
        // 在此直接过 normalizeYamlError 转码后抛出（错误通道迁移四期，边界保留点）；
        // 外层 catch 见到已带「Agent YAML 无效」前缀的产物原样放行，避免二次套前缀。
        throw normalizeYamlError(validation.error, "Agent YAML 无效");
      }
      const saved = await runtime.agentRegistry.upsert(agentId, def, {
        registeredToolNames: probe.list(),
      });
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
