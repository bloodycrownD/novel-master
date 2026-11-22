-- Skills 负清单表 DDL。

CREATE TABLE IF NOT EXISTS skill_disabled_rule (
    -- 域键：当前约定为 project:{pid}，全局域预留
    scope_key TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    PRIMARY KEY (scope_key, skill_name)
  );

CREATE INDEX IF NOT EXISTS idx_skill_disabled_scope ON skill_disabled_rule(scope_key);
