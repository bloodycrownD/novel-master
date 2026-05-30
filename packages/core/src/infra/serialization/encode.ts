/**
 * Encode domain values to wire objects for persistence.
 *
 * @module infra/serialization/encode
 */

import type { ZodType } from "zod";
import { ConfigDecodeError } from "@/errors/config-decode-errors.js";

/** Schema with optional wire encoder for {@link encode}. */
export type EncodableSchema<T> = ZodType<T> & {
  readonly encode?: (value: T) => unknown;
};

/**
 * Converts a domain value to a JSON-serializable wire object.
 */
export function encode<T>(value: T, schema: EncodableSchema<T>): unknown {
  const encoder = schema.encode;
  if (encoder == null) {
    throw new ConfigDecodeError(
      "ENCODE_NOT_SUPPORTED",
      "schema does not define encode",
    );
  }
  return encoder(value);
}
