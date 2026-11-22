/**
 * SQLite `sksp_secrets` 编排抽象基类。
 *
 * 模板方法模式：base 负责校验 ref、跑 SELECT/INSERT/DELETE（SQL 文本见
 * resources/sql/sksp.mapper.xml 的 sksp 语句），加密/解密通过
 * {@link SkspCryptoStrategy} 委托给子类。
 *
 * 三端 `has`/`delete` 逐字相同；`get` 前半段（SELECT + algo 校验）也相同，
 * 密文/iv 的解码与 null 检查全部下放 strategy；`set` 后半段
 * （INSERT ... ON CONFLICT）相同，前半段先调 strategy 拿密文。
 *
 * @module infra/sksp/impl/base-sqlite-secret-store
 */

import type { TdbcConnection } from "../../tdbc/ports/connection.port.js";
import { TdbcTemplate } from "../../tdbc/logic/template-helper.js";
import { SqlTemplateParser } from "../../sql-template/index.js";
import { SkspSql } from "@/infra/sql-template/generated/sksp.mapper.generated.js";
import { SkspError, SkspRefAssert } from "../sksp-error.js";
import type { SecretStore } from "../ports/secret-store.port.js";
import type { SkspCryptoStrategy } from "./sksp-strategy.port.js";

/**
 * 三端 SQLite secret store 的公共骨架。
 * 子类只要传一个 {@link SkspCryptoStrategy} 进来，就拿到了完整的 SecretStore。
 */
export abstract class BaseSqliteSecretStore implements SecretStore {
  private readonly parser = new SqlTemplateParser();

  constructor(protected readonly conn: TdbcConnection, protected readonly strategy: SkspCryptoStrategy) {}

  async get(ref: string): Promise<string | null> {
    SkspRefAssert.validRef(ref);
    const rows = await TdbcTemplate.query(this.conn, this.parser, SkspSql.get, { ref });
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    if (String(row.algo) !== this.strategy.algo) {
      throw new SkspError("DECRYPT_FAILED", `Unsupported algo for ${ref}. Re-run: nm provider edit --apiKey`, { ref });
    }
    return this.strategy.decrypt(ref, row);
  }

  async has(ref: string): Promise<boolean> {
    SkspRefAssert.validRef(ref);
    const rows = await TdbcTemplate.query(this.conn, this.parser, SkspSql.has, { ref });
    return rows.length > 0;
  }

  async set(ref: string, plain: string): Promise<void> {
    SkspRefAssert.validRef(ref);
    // strategy 返回的 iv 允许为 null（Windows DPAPI），模板 `#{iv}` 原样绑定。
    const { ciphertext, iv } = await this.strategy.encrypt(ref, plain);
    const now = Date.now();
    await TdbcTemplate.execute(this.conn, this.parser, SkspSql.set, { ref, ciphertext, iv, algo: this.strategy.algo, updatedAtMs: now });
  }

  async delete(ref: string): Promise<boolean> {
    SkspRefAssert.validRef(ref);
    const result = await TdbcTemplate.execute(this.conn, this.parser, SkspSql.delete, { ref });
    return result.changes > 0;
  }
}
