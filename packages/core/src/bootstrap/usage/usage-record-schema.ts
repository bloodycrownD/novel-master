/**
 * Usage Record 表 DDL（独立用量账本）。
 *
 * @module bootstrap/usage/usage-record-schema
 */

/**
 * 幂等 DDL：`usage_record` 与两条索引（created_at_ms 时间轴 / session_id 溯源）。
 *
 * 独立用量账本，按请求粒度一行（一次带 token 真值的 LLM 请求 = 一行），列名与
 * `chat_message` 的统计列同名同义——统计读口 SQL（聚合 SELECT / 时间与模型、
 * 服务商筛选片断）原样复用。**账本与内容分离**：本表只写不删，不设外键、不挂
 * 级联，删除会话 / 删除消息 / 回滚截尾 / 清空 / 删项目都不碰它，统计数字因此
 * 不随内容消失。本表上线前的历史数据不回填（空表直接上，统计自本表上线起算）。
 *
 * 溯源列（session_id / message_seq）仅供会话维度读口与问题定位，会话删除后
 * 保持原值不清理——本表不依赖 `chat_session` / `chat_message` 任何一行的存在。
 *
 * **记账点唯一**：账本行只在 `DefaultMessageService.append` 产生——fork/copy
 * 复制的消息走 `batchInsert`、不产生新账本行（源请求已在源会话记账），故
 * fork 会话的 `getSessionUsageDetail.last` 在其自身首次新请求前为 null
 * （此时可见消息数非零，两者口径不同属预期，非缺陷）。
 */
export const USAGE_RECORD_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS usage_record (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_record_created_at
    ON usage_record(created_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_record_session
    ON usage_record(session_id)`,
];
