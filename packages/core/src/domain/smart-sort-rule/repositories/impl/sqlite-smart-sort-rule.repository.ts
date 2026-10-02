/**
 * SQLite `smart_sort_rule` repository.
 *
 * @module domain/smart-sort-rule/repositories/impl/sqlite-smart-sort-rule.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type {
  SmartSortCaptureKind,
  SmartSortRule,
} from "../../model/smart-sort-rule.js";
import type { SmartSortRuleRepository } from "../smart-sort-rule.port.js";

function rowToRule(row: Row): SmartSortRule {
  const captureKind = String(row.capture_kind ?? "smart");
  return {
    ruleId: String(row.rule_id),
    name: String(row.name),
    pattern: String(row.pattern),
    flags: String(row.flags ?? ""),
    captureKind: (
      ["smart", "fixed_min", "fixed_max"] as const
    ).includes(captureKind as "smart" | "fixed_min" | "fixed_max")
      ? (captureKind as SmartSortCaptureKind)
      : "smart",
    description: row.description != null ? String(row.description) : null,
    enabled: Number(row.enabled) !== 0,
    sortOrder: Number(row.sort_order),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

const SELECT_COLUMNS = `rule_id, name, pattern, flags, capture_kind, description, enabled,
       sort_order, created_at_ms, updated_at_ms`;

/** TDBC-backed smart sort rule repository. */
export class SqliteSmartSortRuleRepository implements SmartSortRuleRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listOrdered(): Promise<SmartSortRule[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${SELECT_COLUMNS}
       FROM smart_sort_rule
       ORDER BY sort_order ASC, rule_id ASC`,
      {}
    );
    return rows.map(rowToRule);
  }

  async find(ruleId: string): Promise<SmartSortRule | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ${SELECT_COLUMNS}
       FROM smart_sort_rule WHERE rule_id = #{ruleId}`,
      { ruleId }
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToRule(rows[0]!);
  }

  async insert(rule: SmartSortRule): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO smart_sort_rule (
        rule_id, name, pattern, flags, capture_kind, description, enabled,
        sort_order, created_at_ms, updated_at_ms
      ) VALUES (
        #{ruleId}, #{name}, #{pattern}, #{flags}, #{captureKind}, #{description}, #{enabled},
        #{sortOrder}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
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
      }
    );
  }

  async update(rule: SmartSortRule): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE smart_sort_rule SET
        name = #{name},
        pattern = #{pattern},
        flags = #{flags},
        capture_kind = #{captureKind},
        description = #{description},
        enabled = #{enabled},
        sort_order = #{sortOrder},
        updated_at_ms = #{updatedAtMs}
       WHERE rule_id = #{ruleId}`,
      {
        ruleId: rule.ruleId,
        name: rule.name,
        pattern: rule.pattern,
        flags: rule.flags,
        captureKind: rule.captureKind,
        description: rule.description,
        enabled: rule.enabled ? 1 : 0,
        sortOrder: rule.sortOrder,
        updatedAtMs: rule.updatedAtMs,
      }
    );
  }

  /**
   * 每片至多 200 对（对齐 `SqliteMessageRepository.BATCH_PARAM_BUILD_CHUNK`）：
   * 老版本 SQLite 有 999 变量上限，一对占 2 个变量 ⇒ 单片 200 对 = 400 变量，
   * 留足余量。600 对的 reorder 会分 3 片下发。
   */
  private static readonly SORT_ORDER_CHUNK = 200;

  async updateSortOrders(
    pairs: readonly { readonly ruleId: string; readonly sortOrder: number }[]
  ): Promise<void> {
    // 空数组直接返回，不发 SQL（照 batchInsert 的空数组约定）。
    if (pairs.length === 0) {
      return;
    }
    const chunkSize = SqliteSmartSortRuleRepository.SORT_ORDER_CHUNK;
    for (let start = 0; start < pairs.length; start += chunkSize) {
      const chunk = pairs.slice(start, start + chunkSize);
      const cases: string[] = [];
      const idNames: string[] = [];
      const params: Record<string, unknown> = {};
      chunk.forEach((pair, i) => {
        const idName = `rid${i}`;
        const orderName = `ord${i}`;
        cases.push(`WHEN #{${idName}} THEN #{${orderName}}`);
        idNames.push(idName);
        params[idName] = pair.ruleId;
        params[orderName] = pair.sortOrder;
      });
      const sql =
        `UPDATE smart_sort_rule SET sort_order = CASE rule_id ` +
        `${cases.join(" ")} ELSE sort_order END ` +
        `WHERE rule_id IN (${idNames.map((n) => `#{${n}}`).join(", ")})`;
      // 参数按占位符名传：evaluator 按占位符**出现顺序**逐个绑定，同名占位符
      // 出现两次就绑两次 ⇒ CASE 里先绑 rid/ord，WHERE 的 IN 再绑一遍 rid。
      await executeTemplate(this.conn, this.parser, sql, params);
    }
  }

  async delete(ruleId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM smart_sort_rule WHERE rule_id = #{ruleId}`,
      { ruleId }
    );
  }

  async deleteAll(): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM smart_sort_rule`,
      {}
    );
  }

  async nextSortOrder(): Promise<number> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM smart_sort_rule`,
      {}
    );
    const max = Number(rows[0]?.max_sort ?? 0);
    return max + 1;
  }
}
