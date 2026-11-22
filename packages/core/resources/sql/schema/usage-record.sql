-- Usage Record 表 DDL（独立用量账本）。

CREATE TABLE IF NOT EXISTS usage_record (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 溯源：产生本请求的会话（可空；不设外键，会话删除后本行保留）
    session_id TEXT NULL,
    -- 溯源：本请求对应的 assistant 消息在会话内的 seq（供会话详情弹窗）
    message_seq INTEGER NULL,
    -- 协议快照（anthropic/openai/gemini）：命中率分母的 anthropic 加法项依据
    provider TEXT NULL,
    -- 服务商配置 id 快照（写入时记，服务商删除/改名不回写历史行）
    provider_id TEXT NULL,
    model_name TEXT NULL,
    prompt_tokens INTEGER NULL,
    completion_tokens INTEGER NULL,
    total_tokens INTEGER NULL,
    cache_read_tokens INTEGER NULL,
    cache_creation_tokens INTEGER NULL,
    first_token_ms INTEGER NULL,
    duration_ms INTEGER NULL,
    -- 请求完成落库时刻（统计时间轴与桶归属依据）
    created_at_ms INTEGER NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_usage_record_created_at
    ON usage_record(created_at_ms);

CREATE INDEX IF NOT EXISTS idx_usage_record_session
    ON usage_record(session_id);
