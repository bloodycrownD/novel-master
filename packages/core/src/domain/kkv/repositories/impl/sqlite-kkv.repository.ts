/**
 * SQLite KKV repository using SqlTemplateParser.
 *
 * @module domain/kkv/repositories/impl/sqlite-kkv.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { KkvSql } from "@/infra/sql-template/generated/kkv.mapper.generated.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { KkvEntry } from "../../model/kkv-entry.js";
import type { KkvRepository } from "../kkv.port.js";

/**
 * TDBC-backed `kkv_entry` repository.
 */
export class SqliteKkvRepository implements KkvRepository {
    private readonly parser = new SqlTemplateParser();

    constructor(private readonly conn: TdbcConnection) {}

    async listKeys(module: string): Promise<string[]> {
        const rows = await TdbcTemplate.query<{ key: string }>(this.conn, this.parser, KkvSql.listKeysByModule, { module });
        return rows.map((row) => String(row.key));
    }

    async get(module: string, key: string): Promise<KkvEntry | null> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, KkvSql.getByKey, { module, key });
        if (rows.length === 0) {
            return null;
        }
        const row = rows[0]!;
        return { module: String(row.module), key: String(row.key), value: String(row.value) };
    }

    async set(module: string, key: string, value: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, KkvSql.upsert, { module, key, value });
    }

    async delete(module: string, key: string): Promise<boolean> {
        const result = await TdbcTemplate.execute(this.conn, this.parser, KkvSql.deleteByKey, { module, key });
        return result.changes > 0;
    }
}
