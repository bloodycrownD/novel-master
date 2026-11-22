/**
 * Maps better-sqlite3 row objects to TDBC {@link Row} values.
 *
 * @module tdbc-driver-better-sqlite3/row-mapper
 */

import type { Row, SqlValue } from "@novel-master/core";

/** Converts a driver row record to a TDBC row. */
export namespace RowMapper {
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

    export function map(record: Record<string, unknown>): Row {
        const row: Row = {};
        for (const [key, value] of Object.entries(record)) {
            row[key] = mapValue(value);
        }
        return row;
    }
}
