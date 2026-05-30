/**
 * String encoding for boolean values stored in KKV.
 *
 * @module infra/kkv-value-codec
 */

/** Parses KKV-stored `"true"` / `"false"`. */
export function parseBoolean(value: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Expected boolean string, got: ${value}`);
}

/** Formats a boolean for KKV storage (`nm-preferences` module). */
export function formatBoolean(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}
