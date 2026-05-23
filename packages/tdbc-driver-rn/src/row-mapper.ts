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

function rowFromObject(record: Record<string, unknown>): Row {
  const row: Row = {};
  for (const [key, value] of Object.entries(record)) {
    row[key] = mapValue(value);
  }
  return row;
}

function rowFromArray(values: unknown[], columnNames: readonly string[]): Row {
  const row: Row = {};
  const len = Math.min(columnNames.length, values.length);
  for (let i = 0; i < len; i++) {
    row[columnNames[i]!] = mapValue(values[i]);
  }
  return row;
}

/** Builds TDBC rows from a quick-sqlite result. */
export function rowsFromResult(result: QuickSqliteResult): Row[] {
  if (!result.rows || result.rows.length === 0) {
    return [];
  }
  const columnNames = result.columnNames;
  return result.rows.map((record) => {
    if (Array.isArray(record) && columnNames && columnNames.length > 0) {
      return rowFromArray(record, columnNames);
    }
    if (record !== null && typeof record === "object" && !Array.isArray(record)) {
      return rowFromObject(record as Record<string, unknown>);
    }
    return {};
  });
}
