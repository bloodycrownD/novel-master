/**
 * Parse YAML or JSON text to unknown.
 *
 * @module infra/serialization/parse-text
 */

import { parse as parseYaml } from "yaml";
import { ConfigDecodeError } from "@/errors/config-decode-errors.js";

export type TextFormat = "yaml" | "json";

/**
 * Parses a string as YAML or JSON into an untyped value.
 */
export function parseText(source: string, format: TextFormat): unknown {
  if (format === "json") {
    try {
      return JSON.parse(source) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON";
      throw new ConfigDecodeError("INVALID_SCHEMA", message);
    }
  }
  try {
    return parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid YAML";
    throw new ConfigDecodeError("INVALID_SCHEMA", message);
  }
}
