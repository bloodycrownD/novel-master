/**
 * SQLite 用量账本仓储（SqlTemplateParser）。
 *
 * @module domain/usage/repositories/impl/sqlite-usage-record.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { UsageRecordInsert } from "../../model/usage-record.js";
import type { UsageRecordRepository } from "../usage-record.port.js";
import { UsageRecordSql } from "@/infra/sql-template/generated/usage_record.mapper.generated.js";

/**
 * 基于 TDBC 的 `usage_record` 仓储。
 *
 * 只实现 INSERT：账本行只增不删（删除链不碰本表，接口层也不暴露删除口）。
 * 构造参数可为根连接或事务连接——写入点与消息 INSERT 同事务落库时由调用方
 * 传入事务句柄（`conn.transaction` 的 tx）。
 */
export class SqliteUsageRecordRepository implements UsageRecordRepository {
    private readonly parser = new SqlTemplateParser();

    constructor(private readonly conn: TdbcConnection) {}

    async insert(record: UsageRecordInsert): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, UsageRecordSql.insert, { ...record });
    }
}
