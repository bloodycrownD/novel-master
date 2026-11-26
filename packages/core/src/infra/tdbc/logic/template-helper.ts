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
        const parsed = parser.parse(template, params);
        // nm-throw: keep — tdbc 驱动层 reject 契约（TdbcConnection 的失败通道就是 reject：
        // CONNECTION_CLOSED / NESTED_TRANSACTION，connection.port.ts:10-11/:37），模板解析
        // 失败沿同一 reject 通道上行，仓储调用点的错误语义不变；本文件在 throw-audit 白名单
        // tdbc-driver 类内（throw-audit.ts:95）。
        if (!parsed.ok) throw parsed.error;
        return connection.execute(parsed.value.sql, parsed.value.parameters);
    },

    /**
   * Parses a template and runs {@link TdbcConnection.query}.
   */
    async query<T extends Row = Row>(connection: TdbcConnection, parser: SqlTemplateParser, template: string, params: Record<string, unknown>): Promise<T[]> {
        const parsed = parser.parse(template, params);
        // nm-throw: keep — tdbc 驱动层 reject 契约（TdbcConnection 的失败通道就是 reject：
        // CONNECTION_CLOSED / NESTED_TRANSACTION，connection.port.ts:10-11/:37），模板解析
        // 失败沿同一 reject 通道上行，仓储调用点的错误语义不变；本文件在 throw-audit 白名单
        // tdbc-driver 类内（throw-audit.ts:95）。
        if (!parsed.ok) throw parsed.error;
        return connection.query<T>(parsed.value.sql, parsed.value.parameters);
    },
} as const;
