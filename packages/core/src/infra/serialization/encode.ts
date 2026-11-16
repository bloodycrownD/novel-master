/**
 * Encode domain values to wire objects for persistence.
 *
 * @module infra/serialization/encode
 */

import type { ZodType } from "zod";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";

/** Schema with optional wire encoder for {@link encode}. */
export type EncodableSchema<T> = ZodType<T> & {
  /** Wire encoder; not named `encode` to avoid clashing with Zod v4 `.encode()`. */
  readonly toWire?: (value: T) => Result<unknown, AppError>;
};

/**
 * Converts a domain value to a JSON-serializable wire object; 已知失败
 * （如 agent 定义的块名唯一性门禁）沿 `Result.err` 回传，不抛。
 */
export function encode<T>(value: T, schema: EncodableSchema<T>): Result<unknown, AppError> {
  const encoder = schema.toWire;
  if (encoder == null) {
    return Result.err(new AppError("CONFIG_DECODE_ENCODE_NOT_SUPPORTED", { detail: "schema does not define toWire" }));
  }
  return encoder(value);
}
