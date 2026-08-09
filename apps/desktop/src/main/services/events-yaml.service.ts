/**
 * Events config YAML import/export via Electron dialog.
 *
 * @module services/events-yaml
 */
import { decode, encode, parseText, stringifyText } from "@novel-master/core";

import { eventsConfigSchema, type EventsConfig } from "@novel-master/core/events";
import type { BrowserWindow } from "electron";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";
import {
  exportYamlWithDialog,
  importYamlWithDialog,
  normalizeYamlError,
} from "./yaml-shared.js";

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
  return exportYamlWithDialog(yaml, "events.config.yaml", parentWindow);
}

export async function importEventsYamlWithDialog(
  runtime: DesktopNovelMasterRuntime,
  parentWindow?: BrowserWindow | null,
): Promise<"imported" | "cancelled"> {
  return importYamlWithDialog(async (yaml) => {
    try {
      const config = decodeEventsYamlText(yaml);
      await runtime.eventsConfig.setConfig(config);
    } catch (error) {
      throw normalizeYamlError(error, "Events YAML 无效");
    }
  }, parentWindow);
}
