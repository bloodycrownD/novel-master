/**
 * Smart sort rule table DDL.
 *
 * @module bootstrap/smart-sort-rule/smart-sort-rule-schema
 */

/** Canonical table: smart sort rules（单表无分组，spec D2）. */
export const SMART_SORT_RULE_TABLE = "smart_sort_rule";
/** Canonical index on rule priority order. */
export const SMART_SORT_RULE_ORDER_INDEX = "idx_smart_sort_rule_order";

/** Idempotent DDL for smart_sort_rule（spec Step 1 表结构）. */
export const SMART_SORT_RULE_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${SMART_SORT_RULE_TABLE} (
    rule_id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*'),
    example TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ${SMART_SORT_RULE_ORDER_INDEX} ON ${SMART_SORT_RULE_TABLE}(sort_order)`,
];
