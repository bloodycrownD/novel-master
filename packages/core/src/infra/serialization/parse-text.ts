/**
 * Parse YAML or JSON text to unknown.
 *
 * @module infra/serialization/parse-text
 */

import { parse as parseYaml } from "yaml";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

export type TextFormat = "yaml" | "json";

/**
 * YAML / JSON 文本解析。
 */
export const SerializationParseText = {
  /**
   * Parses a string as YAML or JSON into an untyped value;
   * 解析失败是用户内容错误，沿 `Result.err` 回传，不抛。
   */
  parse(source: string, format: TextFormat): Result<unknown, AppError> {
    try {
      return Result.ok(format === "json" ? JSON.parse(source) as unknown : parseYaml(source));
    } catch (error) {
      const message = error instanceof Error ? error.message : `invalid ${format.toUpperCase()}`;
      return Result.err(new AppError("CONFIG_DECODE_INVALID_SCHEMA", { detail: message }));
    }
  },
} as const;
