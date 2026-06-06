/**
 * Agent YAML import/export via Electron dialog.
 *
 * @module services/agent-yaml
 */
import {
  agentDefinitionSchema,
  decode,
  encode,
  parseText,
  registerVfsTools,
  stringifyText,
  ToolRegistry,
  validateAgentDefinition,
  type AgentDefinition,
} from "@novel-master/core";
import { dialog, type BrowserWindow } from "electron";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

function normalizeYamlError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return new Error(`${fallback}：${error.message}`);
  }
  return new Error(fallback);
}

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
  const fileName = `${agentId}.agent.yaml`;
  const tmpPath = join(tmpdir(), fileName);
  await writeFile(tmpPath, yaml, "utf8");

  const win = parentWindow ?? undefined;
  try {
    const result = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: fileName,
          filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: fileName,
          filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        });
    if (result.canceled || result.filePath == null) {
      return "cancelled";
    }
    await writeFile(result.filePath, yaml, "utf8");
    return "saved";
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

export async function importAgentYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
  agentId: string,
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  const win = parentWindow ?? undefined;
  const result = win
    ? await dialog.showOpenDialog(win, {
        filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        properties: ["openFile"],
      })
    : await dialog.showOpenDialog({
        filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
        properties: ["openFile"],
      });
  if (result.canceled || result.filePaths.length === 0) {
    return "cancelled";
  }

  const yaml = await readFile(result.filePaths[0]!, "utf8");
  try {
    const def = decodeAgentYamlText(yaml);
    const probe = new ToolRegistry();
    registerVfsTools(probe);
    await validateAgentDefinition(def, { registeredToolNames: probe.list() });
    await runtime.agentRegistry.upsert(agentId, def, {
      registeredToolNames: probe.list(),
    });
    return "imported";
  } catch (error) {
    throw normalizeYamlError(error, "Agent YAML 无效");
  }
}
