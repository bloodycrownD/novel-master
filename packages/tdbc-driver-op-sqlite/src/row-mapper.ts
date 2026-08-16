/**
 * 把 adapter 返回的 rows 映射为 TDBC {@link Row} 值。
 *
 * @module tdbc-driver-op-sqlite/row-mapper
 */

import type { OpSqliteResult } from "./adapter.js";
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
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
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

/** op-sqlite 的 rows 是纯数组；也兼容数组形态与旧 `_array` 形态。 */
function normalizeRowsArray(rows: OpSqliteResult["rows"]): unknown[] {
  if (rows == null) {
    return [];
  }
  if (Array.isArray(rows)) {
    return rows;
  }
  if (typeof rows === "object" && Array.isArray(rows._array)) {
    return rows._array;
  }
  return [];
}

function resolveColumnNames(
  result: OpSqliteResult,
): readonly string[] | undefined {
  if (result.columnNames && result.columnNames.length > 0) {
    return result.columnNames;
  }
  if (result.metadata && result.metadata.length > 0) {
    return result.metadata.map((m) => m.columnName);
  }
  return undefined;
}

/** 从 op-sqlite 结果构建 TDBC rows。 */
export function rowsFromResult(result: OpSqliteResult): Row[] {
  const rawRows = normalizeRowsArray(result.rows);
  if (rawRows.length === 0) {
    return [];
  }
  const columnNames = resolveColumnNames(result);
  return rawRows.map((record) => {
    if (Array.isArray(record) && columnNames && columnNames.length > 0) {
      return rowFromArray(record, columnNames);
    }
    if (record !== null && typeof record === "object" && !Array.isArray(record)) {
      return rowFromObject(record as Record<string, unknown>);
    }
    return {};
  });
}
