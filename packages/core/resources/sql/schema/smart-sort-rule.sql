-- Smart sort rule table DDL.

CREATE TABLE IF NOT EXISTS smart_sort_rule (
    rule_id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT '' CHECK (flags NOT GLOB '*[^gimsuy]*'),
    capture_kind TEXT NOT NULL DEFAULT 'smart' CHECK (capture_kind IN ('smart', 'fixed_min', 'fixed_max')),
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_smart_sort_rule_order ON smart_sort_rule(sort_order);
