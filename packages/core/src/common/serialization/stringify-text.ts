/**
 * Serialize unknown to YAML or JSON text.
 *
 * @module common/serialization/stringify-text
 */

import { stringify as stringifyYaml } from "yaml";

import type { TextFormat } from "./parse-text.js";

export type { TextFormat };

/**
 * 值 → YAML / JSON 文本序列化。
 */
export const SerializationStringifyText = {
    /**
   * Serializes a value to YAML or JSON text.
   */
    stringify(value: unknown, format: TextFormat): string {
        if (format === "json") {
            return `${JSON.stringify(value, null, 2)}\n`;
        }
        return stringifyYaml(value);
    },
} as const;
