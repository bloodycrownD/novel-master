/**
 * SQLite `sksp_secrets` 编排抽象基类。
 *
 * 模板方法模式：base 负责校验 ref、拼 SQL、跑 SELECT/INSERT/DELETE，
 * 加密/解密通过 {@link SkspCryptoStrategy} 委托给子类。
 *
 * 三端 `has`/`delete` 逐字相同；`get` 前半段（SELECT + algo 校验）也相同，
 * 密文/iv 的解码与 null 检查全部下放 strategy；`set` 后半段
 * （INSERT ... ON CONFLICT）相同，前半段先调 strategy 拿密文。
 *
 * @module infra/sksp/impl/base-sqlite-secret-store
 */

import type { TdbcConnection } from "../../tdbc/ports/connection.port.js";
import {
  executeTemplate,
  queryTemplate,
} from "../../tdbc/logic/template-helper.js";
import { SqlTemplateParser } from "../../sql-template/index.js";
import { SkspError, assertValidRef } from "../sksp-error.js";
import type { SecretStore } from "../ports/secret-store.port.js";
import type { SkspCryptoStrategy } from "./sksp-strategy.port.js";

/**
 * 三端 SQLite secret store 的公共骨架。
 * 子类只要传一个 {@link SkspCryptoStrategy} 进来，就拿到了完整的 SecretStore。
 */
export abstract class BaseSqliteSecretStore implements SecretStore {
  private readonly parser = new SqlTemplateParser();

  constructor(
    protected readonly conn: TdbcConnection,
    protected readonly strategy: SkspCryptoStrategy
  ) {}

  async get(ref: string): Promise<string | null> {
    assertValidRef(ref);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT ciphertext, iv, algo, version FROM sksp_secrets WHERE ref = #{ref}`,
      { ref }
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0]!;
    if (String(row.algo) !== this.strategy.algo) {
      throw new SkspError(
        "DECRYPT_FAILED",
        `Unsupported algo for ${ref}. Re-run: nm provider edit --apiKey`,
        { ref }
      );
    }
    return this.strategy.decrypt(ref, row);
  }

  async has(ref: string): Promise<boolean> {
    assertValidRef(ref);
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT 1 AS n FROM sksp_secrets WHERE ref = #{ref} LIMIT 1`,
      { ref }
    );
    return rows.length > 0;
  }

  async set(ref: string, plain: string): Promise<void> {
    assertValidRef(ref);
    // strategy 返回的 iv 允许为 null（Windows DPAPI），模板 `#{iv}` 原样绑定。
    const { ciphertext, iv } = await this.strategy.encrypt(ref, plain);
    const now = Date.now();
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, version, updated_at_ms)
       VALUES (#{ref}, #{ciphertext}, #{iv}, #{algo}, 1, #{updatedAtMs})
       ON CONFLICT(ref) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         algo = excluded.algo,
         version = excluded.version,
         updated_at_ms = excluded.updated_at_ms`,
      {
        ref,
        ciphertext,
        iv,
        algo: this.strategy.algo,
        updatedAtMs: now,
      }
    );
  }

  async delete(ref: string): Promise<boolean> {
    assertValidRef(ref);
    const result = await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM sksp_secrets WHERE ref = #{ref}`,
      { ref }
    );
    return result.changes > 0;
  }
}
