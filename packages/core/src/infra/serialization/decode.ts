/**
 * Decode unknown via Zod schema.
 *
 * @module infra/serialization/decode
 */

import type { ZodType } from "zod";
import { AppError } from "@/errors/app-error.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/**
 * Parses and validates `raw` with `schema`.
 */
export function decode<T>(raw: unknown, schema: ZodType<T>): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("CONFIG_DECODE_INVALID_SCHEMA", { detail: zodMessage(parsed.error) });
  }
  return parsed.data;
}
