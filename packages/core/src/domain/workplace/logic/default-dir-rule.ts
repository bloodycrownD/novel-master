/**
 * 目录未持久化规则行时的默认目录规则字段。
 *
 * 缺省填充策略为头信息（Markdown front matter / 文件头）。
 *
 * @module domain/workplace/logic/default-dir-rule
 */

import type { FillPolicy, SortField, SortOrder } from "../model/workplace-types.js";

/** 目录启用规则但无 {@link WorkplaceDirRule} 行时应用的默认值。 */
export const DEFAULT_WORKPLACE_DIR_RULE = {
  sortField: "name" as const satisfies SortField,
  sortOrder: "asc" as const satisfies SortOrder,
  headCount: 0,
  tailCount: 1000,
  fillPolicy: "header" as const satisfies FillPolicy,
} as const;
