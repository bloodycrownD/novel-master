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
      await validateAgentDefinition(def, { registeredToolNames: probe.list() });
      await runtime.agentRegistry.upsert(agentId, def, {
        registeredToolNames: probe.list(),
      });
    } catch (error) {
      throw normalizeYamlError(error, "Agent YAML 无效");
    }
  }, parentWindow);
}
