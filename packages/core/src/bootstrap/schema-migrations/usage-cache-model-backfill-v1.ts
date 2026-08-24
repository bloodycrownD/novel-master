/**
 * usage-cache-model-backfill-v1：存量 chat_message 的 cache/模型列回填。
 *
 * 分批扫 `chat_message`（`model_name IS NULL AND raw_json IS NOT NULL AND raw_json != ''`），
 * 按 raw_json 形状判协议（Gemini `usageMetadata` / OpenAI `usage.prompt_tokens` 形态 /
 * Anthropic `type`·`message_start`·`usage.input_tokens` 形态），提取
 * cache_read_tokens / cache_creation_tokens / provider / model_name 回写：
 * - provider 仅在当前为 NULL 时写（不覆盖已有值）；
 * - cache 两列仅在能提取且当前为 NULL 时写；
 * - model_name 能提取即写（扫描条件已保证当前为 NULL）；
 * - 判不出协议 / JSON 解析失败 → 整行跳过不写；
 * - 绝不重写 prompt_tokens（spec 决策 1：分母公式按协议适配）。
 *
 * 终止性说明：扫描条件以 `model_name IS NULL` 为准，但残缺流式行（只有
 * `{streamed:true,...}` 占位或缺 usage 输入侧）补不出模型名、条件恒真，所以
 * 不能套用 vfs-content-blob-zlib-v1 那种「更新后行不再命中」的循环，改用
 * 按 `id` keyset 分页单趟扫描——批次推进与行内容解耦，天然收敛；跨次执行
 * 靠「已 applied 不重跑 + 条件写不覆盖」双重幂等。
 *
 * @module bootstrap/schema-migrations/usage-cache-model-backfill-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const USAGE_CACHE_MODEL_BACKFILL_V1_ID = "usage-cache-model-backfill-v1";

/** 分批上限，参照 vfs-content-blob-zlib-v1 的分批策略（防大库一次拉满内存）。 */
const BACKFILL_BATCH_SIZE = 256;

/** raw_json 可判定的协议标识，与 chat_message.provider 列的取值一致。 */
type LlmProtocol = "openai" | "anthropic" | "gemini";

/** 待回填行（只拉判定与回填所需的最小列集）。 */
type BackfillRow = {
  id: string;
  provider: string | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  raw_json: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** cache 计数仅在 >0 时才有意义（0 表示未命中/未写入，与 usage-parser 口径一致）。 */
function positiveNum(value: unknown): number | undefined {
  const n = finiteNum(value);
  return n != null && n > 0 ? n : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function chatMessageColumnNames(
  tx: TdbcConnection,
): Promise<Set<string>> {
  const rows = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('chat_message')`,
  );
  return new Set(rows.map((row) => row.name));
}

/**
 * 确保回填目标列存在：bootstrap 顺序是 DDL → migration → align，老库的
 * `chat_message` 在本 migration 执行时还没有三新列（canonical DDL 的
 * `CREATE TABLE IF NOT EXISTS` 不会给已有表补列），必须自己 ALTER 补齐，
 * 否则分批 SELECT 直接撞 no such column。align 之后对这几列是幂等 no-op。
 */
async function ensureBackfillColumns(tx: TdbcConnection): Promise<void> {
  const cols = await chatMessageColumnNames(tx);
  if (cols.size === 0) {
    return;
  }
  const additions: readonly (readonly [string, string])[] = [
    ["cache_read_tokens", "ALTER TABLE chat_message ADD COLUMN cache_read_tokens INTEGER NULL"],
    [
      "cache_creation_tokens",
      "ALTER TABLE chat_message ADD COLUMN cache_creation_tokens INTEGER NULL",
    ],
    ["model_name", "ALTER TABLE chat_message ADD COLUMN model_name TEXT NULL"],
  ];
  for (const [col, ddl] of additions) {
    if (!cols.has(col)) {
      await tx.execute(ddl);
    }
  }
}

/**
 * 按形状判协议。判定顺序：Gemini → OpenAI → Anthropic，判不出返回 undefined。
 *
 * - Gemini：顶层 `usageMetadata` 是对象；
 * - OpenAI：顶层 `usage` 是对象且带 prompt_tokens 形态字段
 *   （prompt_tokens / completion_tokens / total_tokens 任一为有限数，含无 cache）；
 * - Anthropic：带 `type` / `message_start` 事件字段，或 `usage.input_tokens` 形态。
 */
function detectProtocol(raw: Record<string, unknown>): LlmProtocol | undefined {
  if (isRecord(raw.usageMetadata)) {
    return "gemini";
  }
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  if (
    usage != null &&
    (finiteNum(usage.prompt_tokens) != null ||
      finiteNum(usage.completion_tokens) != null ||
      finiteNum(usage.total_tokens) != null)
  ) {
    return "openai";
  }
  if (typeof raw.type === "string" || raw.message_start !== undefined) {
    return "anthropic";
  }
  if (usage != null && finiteNum(usage.input_tokens) != null) {
    return "anthropic";
  }
  return undefined;
}

/** 协议判定后从 raw 里能提取出的回填值（提取不到的字段保持 undefined）。 */
type Extracted = {
  readonly cacheReadTokens?: number;
  readonly cacheCreationTokens?: number;
  readonly modelName?: string;
};

/**
 * 按协议提取 cache 两列与模型名。
 *
 * Anthropic 的 model / usage 在非流式响应为顶层，message_start 事件则嵌在
 * `message` 下（Step 2 合并形态已拍平到顶层，两种都兼容）；残缺流式
 * （占位 / 缺 usage 输入侧）自然提取不到，由调用方只写 provider。
 */
function extractByProtocol(
  raw: Record<string, unknown>,
  protocol: LlmProtocol,
): Extracted {
  if (protocol === "gemini") {
    const meta = isRecord(raw.usageMetadata) ? raw.usageMetadata : undefined;
    return {
      cacheReadTokens: positiveNum(meta?.cachedContentTokenCount),
      modelName: str(raw.modelVersion),
    };
  }

  if (protocol === "openai") {
    const usage = isRecord(raw.usage) ? raw.usage : undefined;
    const details =
      usage != null && isRecord(usage.prompt_tokens_details)
        ? usage.prompt_tokens_details
        : undefined;
    return {
      cacheReadTokens: positiveNum(details?.cached_tokens),
      modelName: str(raw.model),
    };
  }

  // anthropic：顶层优先，message_start 嵌套形态兜底。
  const message = isRecord(raw.message) ? raw.message : undefined;
  const usage = isRecord(raw.usage)
    ? raw.usage
    : isRecord(message?.usage)
      ? message.usage
      : undefined;
  const cacheCreation = isRecord(usage?.cache_creation)
    ? positiveNum(usage.cache_creation.input_tokens)
    : positiveNum(usage?.cache_creation_input_tokens);
  return {
    cacheReadTokens: positiveNum(usage?.cache_read_input_tokens),
    cacheCreationTokens: cacheCreation,
    modelName: str(raw.model) ?? str(message?.model),
  };
}

/** 单行回填：能写多少写多少，全部条件不满足则不发 UPDATE。 */
async function backfillRow(
  tx: TdbcConnection,
  row: BackfillRow,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.raw_json);
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }
  const protocol = detectProtocol(parsed);
  if (protocol == null) {
    return;
  }
  const extracted = extractByProtocol(parsed, protocol);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (row.provider == null) {
    sets.push("provider = ?");
    params.push(protocol);
  }
  if (row.cache_read_tokens == null && extracted.cacheReadTokens != null) {
    sets.push("cache_read_tokens = ?");
    params.push(extracted.cacheReadTokens);
  }
  if (
    row.cache_creation_tokens == null &&
    extracted.cacheCreationTokens != null
  ) {
    sets.push("cache_creation_tokens = ?");
    params.push(extracted.cacheCreationTokens);
  }
  if (extracted.modelName != null) {
    sets.push("model_name = ?");
    params.push(extracted.modelName);
  }
  if (sets.length === 0) {
    return;
  }
  params.push(row.id);
  await tx.execute(
    `UPDATE chat_message SET ${sets.join(", ")} WHERE id = ?`,
    params,
  );
}

/**
 * 按 `id` keyset 分页分批扫描回填，批大小 {@link BACKFILL_BATCH_SIZE}。
 *
 * 残缺流式行补不出模型名、`model_name IS NULL` 恒真，所以分页游标必须与
 * 行内容解耦（见模块头「终止性说明」），否则会无限循环。
 */
async function up(tx: TdbcConnection): Promise<void> {
  await ensureBackfillColumns(tx);
  let lastId = "";
  for (;;) {
    const rows = await tx.query<BackfillRow>(
      `SELECT id, provider, cache_read_tokens, cache_creation_tokens, raw_json
       FROM chat_message
       WHERE model_name IS NULL
         AND raw_json IS NOT NULL AND raw_json != ''
         AND id > ?
       ORDER BY id
       LIMIT ?`,
      [lastId, BACKFILL_BATCH_SIZE],
    );
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      await backfillRow(tx, row);
    }
    lastId = rows[rows.length - 1]!.id;
  }
}

/** 存量消息 cache/模型列回填 migration。 */
export const usageCacheModelBackfillV1Migration: SchemaMigration = {
  id: USAGE_CACHE_MODEL_BACKFILL_V1_ID,
  up,
};

export { up as usageCacheModelBackfillV1Up };
