/**
 * 服务商三表的 dump / scrub / restore / validate 实现。
 *
 * validate 是 db-backup 还原前对 provider 三表快照的 service 级校验。
 * 设计意图：db-backup import / cloud-sync pull 这两条入口之前直接走 raw INSERT，
 * 完全绕过 service upsert。schema 层 CHECK 只能拦 protocol enum，对 display_name
 * 空字符串、saved_model FK 悬空、sksp_secrets 字段类型等都失防。这里把 service
 * upsert 路径里的运行时约束（requireNonEmptyDisplayName / protocol enum /
 * saved_model.provider_id 必须命中 provider 主键）抽出来作为统一校验入口，
 * restore 在 INSERT 前先跑一遍。
 *
 * 失败走 `DB_BACKUP_*`（125001-125014）码表，替换原快照校验错误类的
 * 14 个 descriptor 构造点；表名与行号保留在 params（`table` / `row_index`）。
 *
 * @module infra/db-backup/provider-table-snapshot
 */

import { Coerce } from "@/common/coerce.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { LlmProtocolKind } from "@/infra/llm-protocol/ports/adapter.port.js";
import type { TdbcConnection } from "../tdbc/ports/connection.port.js";
import type { Row } from "../tdbc/types.js";
import { DB_BACKUP_PROVIDER_TABLES, type ProviderBackupTableName, type ProviderTableSnapshot } from "./provider-tables.js";

/** restore 时插入顺序：先父表再子表，与 FK 一致。 */
const RESTORE_TABLE_ORDER: readonly ProviderBackupTableName[] = ["llm_provider", "llm_saved_model", "sksp_secrets"];

/** scrub 时删除顺序：先子表再父表，避免 FK 约束。 */
const SCRUB_TABLE_ORDER: readonly ProviderBackupTableName[] = ["llm_saved_model", "llm_provider", "sksp_secrets"];

/** 与 LlmProtocolKind 运行时枚举保持一致的单源。 */
const KNOWN_PROTOCOLS: ReadonlySet<LlmProtocolKind> = new Set(["openai", "anthropic", "gemini"]);

export const ProviderTableSnapshotIo = {
  /**
   * 从当前连接主库读取三张服务商表的全量行。
   */
  async dump(conn: TdbcConnection): Promise<ProviderTableSnapshot> {
    const snapshot: Record<ProviderBackupTableName, Row[]> = {
      sksp_secrets: [],
      llm_provider: [],
      llm_saved_model: [],
    };
    for (const table of DB_BACKUP_PROVIDER_TABLES) {
      snapshot[table] = await conn.query(`SELECT * FROM ${table}`);
    }
    return snapshot;
  },

  /**
   * 在当前连接主库上删除三张服务商表的全部行。
   */
  async scrub(conn: TdbcConnection): Promise<void> {
    await ProviderTableSnapshotIo.scrubWithPrefix(conn);
  },

  /**
   * ATTACH 指定路径的数据库后清除其中三张服务商表，再 DETACH。
   *
   * @param conn - 持有主库的连接（live DB）
   * @param attachPath - 待清除副本的绝对路径，通过 `?` 绑定以防注入
   * @param alias - ATTACH 别名（字面量写入 SQL，由调用方控制）
   */
  async scrubInDatabase(conn: TdbcConnection, attachPath: string, alias: string): Promise<void> {
    await conn.execute(`ATTACH DATABASE ? AS ${alias}`, [attachPath]);
    try {
      await ProviderTableSnapshotIo.scrubWithPrefix(conn, alias);
    } finally {
      await conn.execute(`DETACH DATABASE ${alias}`);
    }
  },

  /**
   * 先清空主库三表，再按 FK 顺序将快照写回（单事务）。
   *
   * INSERT 之前先跑 service 级 {@link ProviderTableSnapshotIo.validate}，把过去
   * 绕过 service upsert 的 raw INSERT 路径（db-backup import / cloud-sync pull）
   * 拉回到与 DefaultProviderService.create 等价的校验水位。校验在事务外执行，
   * 校验失败是调用方预期的业务失败（Result 通道），本函数作为写库边界把它
   * 转成 throw，保持「任意行非法则抛 AppError（`DB_BACKUP_*` 码表）、主库保持
   * 原状」的对外契约。
   */
  async restore(conn: TdbcConnection, snapshot: ProviderTableSnapshot): Promise<void> {
    const validation = ProviderTableSnapshotIo.validate(snapshot);
    if (!validation.ok) {
      throw validation.error;
    }
    await conn.transaction(async (tx) => {
      await ProviderTableSnapshotIo.scrubWithPrefix(tx);
      for (const table of RESTORE_TABLE_ORDER) {
        const rows = snapshot[table];
        if (rows.length === 0) {
          continue;
        }
        const columns = Object.keys(rows[0]!);
        const columnList = columns.join(", ");
        const placeholders = columns.map(() => "?").join(", ");
        const sql = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`;
        const parametersList = rows.map((row) => columns.map((column) => row[column] ?? null));
        await tx.batch(sql, parametersList);
      }
    });
  },

  /**
   * 对即将写入主库的快照做整体校验：行级字段 + 跨表 FK 一致性。
   * 任一行非法即返回 `Err`（首错即止），调用方应在事务外先调用本函数，
   * 再决定是否进入 scrub + INSERT 流程。
   *
   * llm_provider 行与 SqliteProviderRepository.rowToProvider +
   * DefaultProviderService.requireNonEmptyDisplayName 对齐；llm_saved_model
   * 只校验两种 schema 都有的不变式（provider_id 命中、vendor_model_id /
   * settings_json 非空）；sksp_secrets 的 iv 允许 NULL，其余字段必填。
   */
  validate(snapshot: ProviderTableSnapshot): Result<void, AppError> {
    for (const [rowIndex, row] of snapshot.llm_provider.entries()) {
      const table: ProviderBackupTableName = "llm_provider";
      const id = Coerce.nonEmptyText(row.id);
      if (id == null) {
        return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_ID_MISSING", { row_index: rowIndex, table }));
      }
      const protocol = Coerce.strictText(row.protocol);
      if (protocol == null || !KNOWN_PROTOCOLS.has(protocol as LlmProtocolKind)) {
        return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_PROTOCOL_INVALID", { row_index: rowIndex, protocol: String(row.protocol), table }));
      }
      if (Coerce.nonEmptyText(row.base_url) == null) {
        return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_BASE_URL_EMPTY", { row_index: rowIndex, id, table }));
      }
      if (Coerce.nonEmptyText(row.display_name) == null) {
        return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_DISPLAY_NAME_EMPTY", { row_index: rowIndex, id, table }));
      }
      if (Coerce.strictNumber(row.is_builtin) == null) {
        return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_IS_BUILTIN_NOT_NUMBER", { row_index: rowIndex, id, table }));
      }
      if (Coerce.strictNumber(row.created_at_ms) == null || Coerce.strictNumber(row.updated_at_ms) == null) {
        return Result.err(new AppError("DB_BACKUP_PROVIDER_ROW_TIMESTAMP_INVALID", { row_index: rowIndex, id, table }));
      }
    }
    const knownProviderIds = new Set(snapshot.llm_provider.map((row) => Coerce.nonEmptyText(row.id)).filter((id): id is string => id != null));
    for (const [rowIndex, row] of snapshot.llm_saved_model.entries()) {
      const table: ProviderBackupTableName = "llm_saved_model";
      const providerId = Coerce.nonEmptyText(row.provider_id);
      if (providerId == null) {
        return Result.err(new AppError("DB_BACKUP_SAVED_MODEL_ROW_PROVIDER_ID_EMPTY", { row_index: rowIndex, table }));
      }
      if (!knownProviderIds.has(providerId)) {
        return Result.err(new AppError("DB_BACKUP_DANGLING_SAVED_MODEL", { row_index: rowIndex, provider_id: providerId, table }));
      }
      if (Coerce.nonEmptyText(row.vendor_model_id) == null) {
        return Result.err(new AppError("DB_BACKUP_SAVED_MODEL_ROW_VENDOR_MODEL_ID_EMPTY", { row_index: rowIndex, provider_id: providerId, table }));
      }
      if (Coerce.strictText(row.settings_json) == null) {
        return Result.err(new AppError("DB_BACKUP_SAVED_MODEL_ROW_SETTINGS_JSON_MISSING", { row_index: rowIndex, provider_id: providerId, table }));
      }
    }
    for (const [rowIndex, row] of snapshot.sksp_secrets.entries()) {
      const table: ProviderBackupTableName = "sksp_secrets";
      const ref = Coerce.nonEmptyText(row.ref);
      if (ref == null) {
        return Result.err(new AppError("DB_BACKUP_SECRET_ROW_REF_MISSING", { row_index: rowIndex, table }));
      }
      if (row.ciphertext == null) {
        return Result.err(new AppError("DB_BACKUP_SECRET_ROW_CIPHERTEXT_MISSING", { row_index: rowIndex, ref, table }));
      }
      if (Coerce.nonEmptyText(row.algo) == null) {
        return Result.err(new AppError("DB_BACKUP_SECRET_ROW_ALGO_EMPTY", { row_index: rowIndex, ref, table }));
      }
      if (Coerce.strictNumber(row.version) == null) {
        return Result.err(new AppError("DB_BACKUP_SECRET_ROW_VERSION_NOT_NUMBER", { row_index: rowIndex, ref, table }));
      }
    }
    return Result.ok(undefined);
  },

  /**
   * 按删除顺序清空指定前缀（或主库）下的三张表。
   */
  async scrubWithPrefix(conn: TdbcConnection, alias?: string): Promise<void> {
    const prefix = alias ? `${alias}.` : "";
    for (const table of SCRUB_TABLE_ORDER) {
      await conn.execute(`DELETE FROM ${prefix}${table}`);
    }
  },
} as const;
