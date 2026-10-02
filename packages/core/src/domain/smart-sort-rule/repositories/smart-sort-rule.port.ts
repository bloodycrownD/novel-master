/**
 * Smart sort rule repository port.
 *
 * @module domain/smart-sort-rule/repositories/smart-sort-rule.port
 */

import type { SmartSortRule } from "../model/smart-sort-rule.js";

/** Persistence for the flat smart_sort_rule table (spec D2). */
export interface SmartSortRuleRepository {
  /** 全量按 sort_order（同序按 rule_id 稳定）。 */
  listOrdered(): Promise<SmartSortRule[]>;
  find(ruleId: string): Promise<SmartSortRule | null>;
  insert(rule: SmartSortRule): Promise<void>;
  /** 整行更新（含 sort_order）。 */
  update(rule: SmartSortRule): Promise<void>;
  /**
   * 批量重排：一条 `UPDATE … CASE WHEN … END` 把 sort_order 按 pairs 落库
   * （`renumber` 下沉用，替掉「只改一个 sort_order 也重写 10 列整行」的逐条 UPDATE）。
   *
   * @remarks
   * - **只改 `sort_order`，不刷 `updated_at_ms`**——沿用 service 层 `renumber`
   *   的既有语义（注释「时间戳不刷」），否则 UI 的「最近修改」排序会跟着变。
   * - 空数组是 no-op（不发 SQL），照 `batchInsert` 的空数组约定。
   * - 实现须对 pairs 分片（对齐 `SqliteMessageRepository.BATCH_PARAM_BUILD_CHUNK`
   *   = 200）以避开老版本 SQLite 的 999 变量上限。
   */
  updateSortOrders(
    pairs: readonly { readonly ruleId: string; readonly sortOrder: number }[]
  ): Promise<void>;
  delete(ruleId: string): Promise<void>;
  /** 清空全部行（含内置；替换式导入用，spec D10）。 */
  deleteAll(): Promise<void>;
  nextSortOrder(): Promise<number>;
}
