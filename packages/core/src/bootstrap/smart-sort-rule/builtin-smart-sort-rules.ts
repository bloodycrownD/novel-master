/**
 * 内置智能排序规则常量与幂等 seed。
 *
 * 内置规则以 `builtin-` 前缀的固定 rule_id 标识（spec D3）：seed 每次启动
 * `INSERT OR IGNORE`——已存在的行（含被用户禁用/改名的内置规则）原样保留，
 * 不覆盖；因此「禁用某内置规则后重启保持禁用」。service 层 delete 对
 * `builtin-` 前缀拒绝（仅可禁用不可删除）；唯一删除路径是恢复默认
 * （DELETE WHERE rule_id LIKE 'builtin-%' 后重灌，Step 7 实现）。
 *
 * 优先级（sort_order）按 spec 附录 A 定案（D13 后内置 4→7 条）：三条
 * fixed 档规则排最前（序章类 1 / 终章类 2 / 番外类 3），四条 smart 档
 * 数字规则顺延 4..7。固定档匹配的是特殊词开头，与数字规则无抢占冲突；
 * volume-chapter 复合规则必须排在 zh-chapter 之前，否则「第2卷 第13章」
 * 会被单序号规则抢占、只提取卷号丢失章号（已 node 验证）。
 *
 * @module bootstrap/smart-sort-rule/builtin-smart-sort-rules
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { SmartSortCaptureKind } from "@/domain/smart-sort-rule/model/smart-sort-rule.js";
import { SMART_SORT_RULE_TABLE } from "./smart-sort-rule-schema.js";

/** 内置规则 seed 行（pattern 按 spec 附录 A 定案；description 为描述文字）. */
export interface BuiltinSmartSortRuleSeedRow {
  readonly ruleId: string;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly captureKind: SmartSortCaptureKind;
  readonly description: string;
  readonly sortOrder: number;
}

/** 序号字符类（附录 A 的 NUM：阿拉伯 + 中文数字大小写，两处捕获组共用）。 */
const NUM_CLASS =
  "[0-9〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,12}";

/**
 * 内置规则集（D13 后 4→7 条）：sort_order 即默认优先级（小者先试、首命中
 * 负责提取）。存量库重跑 seed 时三条新行按新 sortOrder 1..3 插入，与存量
 * 四行的旧 sort_order 1..4 撞号——listOrdered 以 (sort_order, rule_id)
 * 全序决胜，固定档特殊词与数字规则无抢占冲突，语义不受影响；调序/恢复
 * 默认会整表重编号收敛。
 */
export const BUILTIN_SMART_SORT_RULE_ROWS: readonly BuiltinSmartSortRuleSeedRow[] =
  [
    {
      ruleId: "builtin-zh-prologue",
      name: "序章/开篇",
      pattern: `^(序章?|楔子|引子|前言|开篇)`,
      flags: "",
      captureKind: "fixed_min",
      description: "序章/楔子/引子等开篇文字，排在所有章节之前",
      sortOrder: 1,
    },
    {
      ruleId: "builtin-zh-finale",
      name: "终章/收尾",
      pattern: `^(终章|尾声|后记|完结|finale)`,
      flags: "",
      captureKind: "fixed_max",
      description: "终章/尾声/后记等收尾文字，排在所有章节之后",
      sortOrder: 2,
    },
    {
      ruleId: "builtin-zh-extra",
      name: "番外/外传",
      pattern: `^(番外|外传|if篇?)`,
      flags: "",
      captureKind: "fixed_max",
      description: "番外/外传等衍生内容，排在终章之后",
      sortOrder: 3,
    },
    {
      ruleId: "builtin-zh-volume-chapter",
      name: "中文卷章复合",
      pattern: `第[ \\t]{0,2}(${NUM_CLASS})[ \\t]{0,2}卷[ \\t]*[-—·.、]?[ \\t]*第[ \\t]{0,2}(${NUM_CLASS})[ \\t]{0,2}章`,
      flags: "",
      captureKind: "smart",
      description: "匹配 第X卷…第Y章 复合结构，序号取 [卷,章]",
      sortOrder: 4,
    },
    {
      ruleId: "builtin-zh-chapter",
      name: "中文序号章节",
      pattern: `第[ \\t]{0,2}(${NUM_CLASS})[ \\t]{0,2}(?:章|节|集|部|篇|回|卷)`,
      flags: "",
      captureKind: "smart",
      description:
        "匹配 第X章/节/集/部/篇/回/卷 形式的标题（X 支持中文与阿拉伯数字）",
      sortOrder: 5,
    },
    {
      ruleId: "builtin-en-chapter",
      name: "英文章节",
      pattern: `(?:chapter|section|part|episode)[ \\t]*[.．]?[ \\t]*([0-9]{1,6})`,
      flags: "i",
      captureKind: "smart",
      description: "匹配 Chapter/Section/Part/Episode N 英文标题（忽略大小写）",
      sortOrder: 6,
    },
    {
      ruleId: "builtin-numeric",
      name: "数字序号开头",
      pattern: `^[ \\t]*([0-9]{1,6})[ \\t]*(?:[、.．\\-—_]|$)`,
      flags: "",
      captureKind: "smart",
      description: "匹配数字序号开头的文件名，如 001、开端",
      sortOrder: 7,
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
        rule_id, name, pattern, flags, capture_kind, description, enabled,
        sort_order, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        row.ruleId,
        row.name,
        row.pattern,
        row.flags,
        row.captureKind,
        row.description,
        row.sortOrder,
        now,
        now,
      ]
    );
  }
}
