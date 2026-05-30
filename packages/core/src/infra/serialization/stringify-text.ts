/**
 * Serialize unknown to YAML or JSON text.
 *
 * @module infra/serialization/stringify-text
 */

import { stringify as stringifyYaml } from "yaml";

export type TextFormat = "yaml" | "json";

/**
 * Serializes a value to YAML or JSON text.
 */
export function stringifyText(value: unknown, format: TextFormat): string {
  if (format === "json") {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  return stringifyYaml(value);
}
