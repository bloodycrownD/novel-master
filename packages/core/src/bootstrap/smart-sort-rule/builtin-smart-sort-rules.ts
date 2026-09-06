/**
 * 内置智能排序规则常量与幂等 seed。
 *
 * 内置规则以 `builtin-` 前缀的固定 rule_id 标识（spec D3）：seed 每次启动
 * `INSERT OR IGNORE`——已存在的行（含被用户禁用/改名的内置规则）原样保留，
 * 不覆盖；因此「禁用某内置规则后重启保持禁用」。service 层 delete 对
 * `builtin-` 前缀拒绝（仅可禁用不可删除）；唯一删除路径是恢复默认
 * （DELETE WHERE rule_id LIKE 'builtin-%' 后重灌，Step 7 实现）。
 *
 * 四条规则的优先级（sort_order）按 spec 附录 A 定案：volume-chapter 复合
 * 规则必须排在 zh-chapter 之前，否则「第2卷 第13章」会被单序号规则抢占、
 * 只提取卷号丢失章号（已 node 验证）。
 *
 * @module bootstrap/smart-sort-rule/builtin-smart-sort-rules
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SMART_SORT_RULE_TABLE } from "./smart-sort-rule-schema.js";

/** 内置规则 seed 行（pattern 按 spec 附录 A 原样定案）. */
export interface BuiltinSmartSortRuleSeedRow {
  readonly ruleId: string;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly example: string;
  readonly sortOrder: number;
}

/** 序号字符类（附录 A 的 NUM：阿拉伯 + 中文数字大小写，两处捕获组共用）。 */
const NUM_CLASS =
  "[0-9〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,12}";

/**
 * 内置规则集：sort_order 即默认优先级（小者先试、首命中负责提取）。
 */
export const BUILTIN_SMART_SORT_RULE_ROWS: readonly BuiltinSmartSortRuleSeedRow[] =
  [
    {
      ruleId: "builtin-zh-volume-chapter",
      name: "中文卷章复合",
      pattern: `第[ \\t]{0,2}(${NUM_CLASS})[ \\t]{0,2}卷[ \\t]*[-—·.、]?[ \\t]*第[ \\t]{0,2}(${NUM_CLASS})[ \\t]{0,2}章`,
      flags: "",
      example: "第2卷 第13章",
      sortOrder: 1,
    },
    {
      ruleId: "builtin-zh-chapter",
      name: "中文序号章节",
      pattern: `第[ \\t]{0,2}(${NUM_CLASS})[ \\t]{0,2}(?:章|节|集|部|篇|回|卷)`,
      flags: "",
      example: "第十二章 风起",
      sortOrder: 2,
    },
    {
      ruleId: "builtin-en-chapter",
      name: "英文章节",
      pattern: `(?:chapter|section|part|episode)[ \\t]*[.．]?[ \\t]*([0-9]{1,6})`,
      flags: "i",
      example: "Chapter 12",
      sortOrder: 3,
    },
    {
      ruleId: "builtin-numeric",
      name: "数字序号开头",
      pattern: `^[ \\t]*([0-9]{1,6})[ \\t]*(?:[、.．\\-—_]|$)`,
      flags: "",
      example: "001、开端",
      sortOrder: 4,
    },
  ];

/**
 * 幂等写入内置智能排序规则（按 rule_id 主键 INSERT OR IGNORE，不覆盖存量行）。
 */
export async function seedBuiltinSmartSortRules(
  conn: TdbcConnection
): Promise<void> {
  const now = Date.now();
  for (const row of BUILTIN_SMART_SORT_RULE_ROWS) {
    await conn.execute(
      `INSERT OR IGNORE INTO ${SMART_SORT_RULE_TABLE} (
        rule_id, name, pattern, flags, example, enabled,
        sort_order, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        row.ruleId,
        row.name,
        row.pattern,
        row.flags,
        row.example,
        row.sortOrder,
        now,
        now,
      ]
    );
  }
}
