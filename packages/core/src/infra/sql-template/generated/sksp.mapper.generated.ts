/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/sksp.mapper.xml 生成，勿手改。
 * namespace=sksp；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const SkspSql = {
    get: `SELECT ciphertext, iv, algo, version
    FROM sksp_secrets
    WHERE ref = #{ref}
`,
    has: `SELECT 1 AS n
    FROM sksp_secrets
    WHERE ref = #{ref}
    LIMIT 1
`,
    set: `INSERT INTO sksp_secrets (ref, ciphertext, iv, algo, version, updated_at_ms)
       VALUES (#{ref}, #{ciphertext}, #{iv}, #{algo}, 1, #{updatedAtMs})
       ON CONFLICT(ref) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         algo = excluded.algo,
         version = excluded.version,
         updated_at_ms = excluded.updated_at_ms
`,
    delete: `DELETE
    FROM sksp_secrets
    WHERE ref = #{ref}
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const SkspSqlParams = {
    get: ["ref"],
    has: ["ref"],
    set: ["ref", "ciphertext", "iv", "algo", "updatedAtMs"],
    delete: ["ref"],
} as const;
