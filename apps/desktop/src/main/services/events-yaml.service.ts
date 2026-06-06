/**
 * Events config YAML import/export via Electron dialog.
 *
 * @module services/events-yaml
 */
import {
  decode,
  encode,
  eventsConfigSchema,
  parseText,
  stringifyText,
  type EventsConfig,
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

export function decodeEventsYamlText(yaml: string): EventsConfig {
  const raw = parseText(yaml, "yaml");
  return decode(raw, eventsConfigSchema);
}

export function encodeEventsYamlText(config: EventsConfig): string {
  const wire = encode(config, eventsConfigSchema);
  return stringifyText(wire, "yaml");
}

export async function exportEventsYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
  parentWindow?: BrowserWindow | null,
): Promise<"saved" | "cancelled"> {
  const config = await runtime.eventsConfig.getConfig();
  const yaml = encodeEventsYamlText(config);
  const fileName = "events.config.yaml";
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

export async function importEventsYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
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
    const config = decodeEventsYamlText(yaml);
    await runtime.eventsConfig.setConfig(config);
    return "imported";
  } catch (error) {
    throw normalizeYamlError(error, "Events YAML 无效");
  }
}
