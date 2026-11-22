/**
 * Optional bridge from SqlTemplateParser output to TDBC connections.
 *
 * @module infra/tdbc/logic/template-helper
 */

import type { SqlTemplateParser } from "../../sql-template/index.js";
import type { TdbcConnection } from "../ports/connection.port.js";
import type { ExecuteResult, Row } from "../types.js";

/**
 * 模板 → SQL 的执行/查询桥（SqlTemplateParser 输出直连 TDBC）。
 */
export const TdbcTemplate = {
    /**
   * Parses a template and runs {@link TdbcConnection.execute}.
   */
    async execute(connection: TdbcConnection, parser: SqlTemplateParser, template: string, params: Record<string, unknown>): Promise<ExecuteResult> {
        const { sql, parameters } = parser.parse(template, params);
        return connection.execute(sql, parameters);
    },

    /**
   * Parses a template and runs {@link TdbcConnection.query}.
   */
    async query<T extends Row = Row>(connection: TdbcConnection, parser: SqlTemplateParser, template: string, params: Record<string, unknown>): Promise<T[]> {
        const { sql, parameters } = parser.parse(template, params);
        return connection.query<T>(sql, parameters);
    },
} as const;
