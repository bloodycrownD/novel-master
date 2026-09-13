/**
 * rename-smart-sort-rule-example-v1：smart_sort_rule 的 example 列改名
 * description（fix ④：字段语义从「示例文件名」泛化为「描述」，更通用清晰）。
 *
 * SQLite 的 RENAME COLUMN 原地改名，存量用户值随行保留；但内置规则的
 * example 值是示例文件名（如「第2卷 第13章」），改名后语义错位，因此迁移
 * 同时把 builtin-% 行的 description 刷为出厂描述文字（与 seed 常量同步，
 * 本文件内联一份历史快照值——迁移不 import canonical 常量，避免随 seed
 * 后续演进漂移）。用户规则行只改名、值原样保留。
 *
 * 幂等探测：PRAGMA table_info 里有 example 且无 description 才跑——
 * 新库（canonical DDL 直接建出 description 列）与已迁移库都早退；
 * applied 记录（SCHEMA_MIGRATIONS 表）之外再加形态探测，双保险。
 *
 * 注意：本迁移走 pending migration 通道（快/慢路径都会跑），canonical DDL
 * 改列名只影响新建库——SCHEMA_BOOT_VERSION 不 bump（RENAME 不属于
 * ALIGN 补列可收敛的形态，存量库必须靠本迁移，v9/v10 那种「快路径跳过」
 * 的教训不适用于 pending migration：它不受 bootVersion 快路径短路）。
 *
 * @module bootstrap/schema-migrations/rename-smart-sort-rule-example-v1
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SMART_SORT_RULE_TABLE } from "../smart-sort-rule/smart-sort-rule-schema.js";
import type { SchemaMigration } from "./schema-migration.types.js";

export const RENAME_SMART_SORT_RULE_EXAMPLE_V1_ID =
  "rename-smart-sort-rule-example-v1";

/**
 * 内置规则出厂描述（历史快照，与 builtin-smart-sort-rules.ts 的 seed 值
 * 同步维护；此处硬编码不 import，防止 canonical 常量后续演进改变历史迁移）。
 */
const BUILTIN_DESCRIPTIONS: ReadonlyArray<{
  readonly ruleId: string;
  readonly description: string;
}> = [
  {
    ruleId: "builtin-zh-volume-chapter",
    description: "匹配 第X卷…第Y章 复合结构，序号取 [卷,章]",
  },
  {
    ruleId: "builtin-zh-chapter",
    description: "匹配 第X章/节/集/部/篇/回/卷 形式的标题（X 支持中文与阿拉伯数字）",
  },
  {
    ruleId: "builtin-en-chapter",
    description: "匹配 Chapter/Section/Part/Episode N 英文标题（忽略大小写）",
  },
  {
    ruleId: "builtin-numeric",
    description: "匹配数字序号开头的文件名，如 001、开端",
  },
];

/** 供测试直接调用的迁移主体。 */
export async function renameSmartSortRuleExampleV1Up(
  tx: TdbcConnection
): Promise<void> {
  const cols = await tx.query<{ name: string }>(
    `SELECT name FROM pragma_table_info('${SMART_SORT_RULE_TABLE}')`
  );
  const names = cols.map((r) => String(r.name));
  // 有 example 且无 description 才需要改名；全新库（DDL 已是 description）
  // 与已迁移库（description 就位、example 不在）都早退。
  if (!names.includes("example") || names.includes("description")) {
    return;
  }
  await tx.execute(
    `ALTER TABLE ${SMART_SORT_RULE_TABLE} RENAME COLUMN example TO description`
  );
  // 内置行 description 刷新为出厂描述（旧值是示例文件名，语义已换）。
  for (const { ruleId, description } of BUILTIN_DESCRIPTIONS) {
    await tx.execute(
      `UPDATE ${SMART_SORT_RULE_TABLE} SET description = ? WHERE rule_id = ?`,
      [description, ruleId]
    );
  }
}

/** smart_sort_rule.example → description 的 RENAME migration。 */
export const renameSmartSortRuleExampleV1Migration: SchemaMigration = {
  id: RENAME_SMART_SORT_RULE_EXAMPLE_V1_ID,
  up: renameSmartSortRuleExampleV1Up,
};
