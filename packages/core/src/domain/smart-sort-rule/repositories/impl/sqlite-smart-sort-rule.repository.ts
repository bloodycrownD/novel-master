/**
 * SQLite `smart_sort_rule` repository.
 *
 * @module domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { SmartSortCaptureKind, SmartSortRule } from "../../model/smart-sort-rule.js";
import type { SmartSortRuleRepository } from "../smart-sort-rule.port.js";
import { SmartSortRuleSql } from "@/infra/sql-template/generated/smart_sort_rule.mapper.generated.js";

function rowToRule(row: Row): SmartSortRule {
  const captureKind = String(row.capture_kind ?? "smart");
  return {
    ruleId: String(row.rule_id),
    name: String(row.name),
    pattern: String(row.pattern),
    flags: String(row.flags ?? ""),
    captureKind: (["smart", "fixed_min", "fixed_max"] as const).includes(captureKind as "smart" | "fixed_min" | "fixed_max") ? (captureKind as SmartSortCaptureKind) : "smart",
    description: row.description != null ? String(row.description) : null,
    enabled: Number(row.enabled) !== 0,
    sortOrder: Number(row.sort_order),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed smart sort rule repository. */
export class SqliteSmartSortRuleRepository implements SmartSortRuleRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listOrdered(): Promise<SmartSortRule[]> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, SmartSortRuleSql.listOrdered, {});
    return rows.map(rowToRule);
  }

  async find(ruleId: string): Promise<SmartSortRule | null> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, SmartSortRuleSql.find, { ruleId });
    if (rows.length === 0) {
      return null;
    }
    return rowToRule(rows[0]!);
  }

  async insert(rule: SmartSortRule): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, SmartSortRuleSql.insert, {
      ruleId: rule.ruleId,
      name: rule.name,
      pattern: rule.pattern,
      flags: rule.flags,
      captureKind: rule.captureKind,
      description: rule.description,
      enabled: rule.enabled ? 1 : 0,
      sortOrder: rule.sortOrder,
      createdAtMs: rule.createdAtMs,
      updatedAtMs: rule.updatedAtMs,
    });
  }

  async update(rule: SmartSortRule): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, SmartSortRuleSql.update, {
      ruleId: rule.ruleId,
      name: rule.name,
      pattern: rule.pattern,
      flags: rule.flags,
      captureKind: rule.captureKind,
      description: rule.description,
      enabled: rule.enabled ? 1 : 0,
      sortOrder: rule.sortOrder,
      updatedAtMs: rule.updatedAtMs,
    });
  }

  /**
   * 每片至多 200 对（对齐 `SqliteMessageRepository.BATCH_PARAM_BUILD_CHUNK`）：
   * 老版本 SQLite 有 999 变量上限，一对占 2 个变量 ⇒ 单片 200 对 = 400 变量，
   * 留足余量。600 对的 reorder 会分 3 片下发。
   */
  private static readonly SORT_ORDER_CHUNK = 200;

  /** nm-style: keep-public — 实现 SmartSortRuleRepository.updateSortOrders 端口方法；内联会把分块 CASE/IN 批量更新 SQL 搬进调用层。 */
  async updateSortOrders(pairs: readonly { readonly ruleId: string; readonly sortOrder: number }[]): Promise<void> {
    // 空数组直接返回，不发 SQL（照 batchInsert 的空数组约定）。
    if (pairs.length === 0) {
      return;
    }
    const chunkSize = SqliteSmartSortRuleRepository.SORT_ORDER_CHUNK;
    for (let start = 0; start < pairs.length; start += chunkSize) {
      // mapper 的 <foreach> 按占位符**出现顺序**逐个绑定：CASE 里先绑每对的
      // ruleId/sortOrder，WHERE 的 IN 再绑一遍 ruleId。
      await TdbcTemplate.execute(this.conn, this.parser, SmartSortRuleSql.updateSortOrders, { pairs: pairs.slice(start, start + chunkSize) });
    }
  }

  async delete(ruleId: string): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, SmartSortRuleSql.delete, { ruleId });
  }

  /** nm-style: keep-public — 实现 SmartSortRuleRepository.deleteAll 端口方法；内联会把删除 SQL 搬进调用层。 */
  async deleteAll(): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, SmartSortRuleSql.deleteAll, {});
  }

  /** nm-style: keep-public — 实现 SmartSortRuleRepository.nextSortOrder 端口方法；内联会把 MAX 查询 SQL 搬进调用层。 */
  async nextSortOrder(): Promise<number> {
    const rows = await TdbcTemplate.query(this.conn, this.parser, SmartSortRuleSql.nextSortOrder, {});
    const max = Number(rows[0]?.max_sort ?? 0);
    return max + 1;
  }
}
