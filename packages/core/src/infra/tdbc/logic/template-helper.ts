/**
 * Optional bridge from SqlTemplateParser output to TDBC connections.
 *
 * @module infra/tdbc/logic/template-helper
 */

import type { SqlTemplateParser } from "../../sql-template/index.js";
import type { TdbcConnection } from "../ports/connection.port.js";
import type { ExecuteResult, Row } from "../types.js";

/**
 * Parses a template and runs {@link TdbcConnection.execute}.
 */
export async function executeTemplate(
  connection: TdbcConnection,
  parser: SqlTemplateParser,
  template: string,
  params: Record<string, unknown>,
): Promise<ExecuteResult> {
  const { sql, parameters } = parser.parse(template, params);
  return connection.execute(sql, parameters);
}

/**
 * Parses a template and runs {@link TdbcConnection.query}.
 */
export async function queryTemplate<T extends Row = Row>(
  connection: TdbcConnection,
  parser: SqlTemplateParser,
  template: string,
  params: Record<string, unknown>,
): Promise<T[]> {
  const { sql, parameters } = parser.parse(template, params);
  return connection.query<T>(sql, parameters);
}
