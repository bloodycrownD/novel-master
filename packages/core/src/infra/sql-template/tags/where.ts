/**
 * `<where>` tag: strip leading AND/OR and prefix WHERE when content is non-empty.
 */

const LEADING_AND_OR = /^\s*(?:AND|OR)\b\s*/i;

/**
 * `<where>` 标签的 SQL 包裹策略。
 */
export const SqlTemplateWhere = {
    /**
   * Removes repeated leading AND/OR tokens (case-insensitive).
   */
    stripLeadingAndOr(content: string): string {
        let s = content;
        while (LEADING_AND_OR.test(s)) {
            s = s.replace(LEADING_AND_OR, "");
        }
        return s;
    },

    /**
   * Wraps inner SQL with WHERE when trimmed content is non-empty.
   */
    wrap(innerSql: string): string {
        const trimmed = innerSql.trim();
        if (!trimmed) return "";
        const body = SqlTemplateWhere.stripLeadingAndOr(innerSql);
        const trimmedBody = body.trimStart();
        if (!trimmedBody) return "";
        return `WHERE ${trimmedBody}`;
    },
} as const;
