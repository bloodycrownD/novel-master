/**
 * Maps adapter rows to TDBC {@link Row} values.
 *
 * @module tdbc-driver-rn/row-mapper
 */

import type { QuickSqliteResult } from "./adapter.js";
import type { Row, SqlValue } from "@novel-master/core";

function mapValue(value: unknown): SqlValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }
  return String(value);
}

/** Builds TDBC rows from a quick-sqlite result. */
export function rowsFromResult(result: QuickSqliteResult): Row[] {
  if (!result.rows || result.rows.length === 0) {
    return [];
  }
  return result.rows.map((record) => {
    const row: Row = {};
    for (const [key, value] of Object.entries(record)) {
      row[key] = mapValue(value);
    }
    return row;
  });
}
