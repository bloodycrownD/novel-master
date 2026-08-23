/**
 * usage-cache-model-backfill-v1：存量 chat_message 的 cache/模型列回填（占位）。
 *
 * 目标：分批扫 `chat_message`（raw_json 非空且 model_name IS NULL），按 raw_json
 * 形状判协议（OpenAI `usage` / Gemini `usageMetadata` / Anthropic `message_start`
 * 或顶层 `usage`），提取 cache_read_tokens / cache_creation_tokens / provider /
 * model_name 回写。实现要求：分批 256、可重入、不重写 prompt_tokens。
 *
 * ⚠️ 当前为 Step 1 占位骨架：尚未登记进 SCHEMA_MIGRATIONS 数组。若以空 up 提前
 * 登记，老测试库会把本 migration 记为已执行，Step 4 填入实现后不会重跑。
 * 登记与实现由 Step 4（phase-backfill-migration）一并完成。
 *
 * @module bootstrap/schema-migrations/usage-cache-model-backfill-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const USAGE_CACHE_MODEL_BACKFILL_V1_ID = "usage-cache-model-backfill-v1";

async function up(tx: TdbcConnection): Promise<void> {
  // Step 4 实现回填逻辑（分批 256、可重入、raw 形状判协议）。
  // 占位阶段本函数保持 no-op 且不登记进 SCHEMA_MIGRATIONS，tx 参数暂未使用。
  void tx;
}

/** 存量消息 cache/模型列回填 migration（占位，Step 4 实现并登记）。 */
export const usageCacheModelBackfillV1Migration: SchemaMigration = {
  id: USAGE_CACHE_MODEL_BACKFILL_V1_ID,
  up,
};
