/**
 * 幂等写入内置 LLM providers（按 builtin_key，不覆盖用户改动）。
 *
 * @module bootstrap/provider/seed-builtin-providers
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { LlmProviderSql } from "@/infra/sql-template/generated/llm_provider.mapper.generated.js";
import { BUILTIN_PROVIDER_ROWS } from "@/domain/provider/logic/builtin-providers.js";

/**
 * 内置服务商 seed 操作族。
 */
export const BuiltinProviders = {
  /**
   * 按 builtin_key 幂等插入内置服务商（已存在则跳过，不覆盖用户编辑）。
   *
   * 错误通道：调用点在 bootstrap 事务内，失败只可能是 SQL/驱动异常（`TdbcError`），
   * throw 是事务回滚的唯一通道；域内没有可判失败，故不套 `Result`。
   */
  async seed(conn: TdbcConnection): Promise<void> {
    const parser = new SqlTemplateParser();
    const now = Date.now();
    for (const row of BUILTIN_PROVIDER_ROWS) {
      const params = { id: row.id, builtinKey: row.key, protocol: row.protocol, baseUrl: row.baseUrl, displayName: row.displayName, now };
      await TdbcTemplate.execute(conn, parser, LlmProviderSql.seedBuiltin, params);
    }
  },
} as const;
