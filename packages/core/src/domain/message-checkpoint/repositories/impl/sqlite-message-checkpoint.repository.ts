/**
 * SQLite implementation of {@link MessageCheckpointRepository}.
 *
 * entry_id 化后 `message_checkpoint_file` 用 `entry_id` 指向 vfs_entry；`loadFileTree`
 * 经 JOIN 取当前 path 返回 `Map<logicalPath, version>`（rename 后仍指向同一 entry，路径
 * 随当前 vfs_entry.path 变化）。ref_count 增减直接吃 entryId，不再需要 scope 映射。
 *
 * @module domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import type { Row } from "@/infra/tdbc/types.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { RevisionRefCount } from "@/domain/vfs/logic/revision-ref-count.js";
import { SqliteVfsRevisionRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.js";
import type { MessageCheckpointFile } from "../../model/message-checkpoint.js";
import type { CheckpointFilePointer, MessageCheckpointDistinctPointer, MessageCheckpointInsertInput, MessageCheckpointRepository } from "../message-checkpoint.port.js";
import { MessageCheckpointSql } from "@/infra/sql-template/generated/message_checkpoint.mapper.generated.js";

function rowToFilePointer(row: Row): MessageCheckpointFile {
    return {
        sessionId: String(row.session_id),
        messageId: String(row.message_id),
        entryId: Number(row.entry_id),
        revisionVersion: Number(row.revision_version),
    };
}

/** 多值 INSERT 每块变量数上限（≤ 老版 SQLITE_MAX_VARIABLE_NUMBER=999，留余量）。 */
const MULTI_VALUES_MAX_VARS = 900;

/** IN 列表每块的变量数上限（≤ 老版 SQLITE_MAX_VARIABLE_NUMBER=999，留余量）。 */
const IN_LIST_MAX_VARS = 900;

/**
 * IN 列表分块：每块 ≤ `IN_LIST_MAX_VARS - 1` 个 id（固定变量是本仓三处都带的
 * 1 个 sessionId）⇒ 含 sessionId 每块 ≤900 个绑定变量。块内占位符序列由 mapper
 * 的 `<foreach collection="ids" item="id">` 展开，每块都是**同一种**模板串。
 */
function* chunkIdList(ids: ReadonlyArray<string>): Generator<ReadonlyArray<string>> {
    const chunkSize = Math.max(1, IN_LIST_MAX_VARS - 1);
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
        yield ids.slice(offset, offset + chunkSize);
    }
}

/**
 * 分块多值 INSERT：mapper 语句内 `<foreach collection="rows">` 按块内行数展开
 * `(?,?,…)` 行组，这里只负责按 900 变量上限切块、扁平化参数并下发。
 *
 * 逐行 conn.batch 在驱动层是逐行 JSI 往返（better-sqlite3 / op-sqlite 均如此），
 * 行数平方级增长的批量播种场景下往返开销远超 SQLite 执行本身。
 * 块内失败时抛错，由外层事务整体回滚（调用方均在事务内）。
 */
async function insertMultiValues(conn: TdbcConnection, parser: SqlTemplateParser, template: string, rows: ReadonlyArray<readonly unknown[]>): Promise<void> {
    if (rows.length === 0) {
        return;
    }
    const paramsPerRow = rows[0]!.length;
    const chunkSize = Math.max(1, Math.floor(MULTI_VALUES_MAX_VARS / paramsPerRow));
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
        const chunk = rows.slice(offset, offset + chunkSize);
        const params: unknown[] = [];
        for (const row of chunk) {
            params.push(...row);
        }
        const rendered = parser.parse(template, { rows: chunk });
        // nm-throw: keep — 仓储方法的失败契约就是 reject（本函数 doc 注释「块内失败时抛错，
        // 由外层事务整体回滚（调用方均在事务内）」；seedCheckpoints 经端口被 ForkCopySeeder
        // 的 seed 事务调用，fork-copy-seeder.ts:119）：解析失败沿同一 reject 通道触发整体
        // 回滚，与 TdbcTemplate 桥同口。
        if (!rendered.ok) throw rendered.error;
        await conn.execute(rendered.value.sql, params);
    }
}

/**
 * TDBC-backed message checkpoint repository.
 */
export class SqliteMessageCheckpointRepository implements MessageCheckpointRepository {
    private readonly parser = new SqlTemplateParser();

    constructor(private readonly conn: TdbcConnection) {}

    async hasCheckpoint(sessionId: string, messageId: string): Promise<boolean> {
        const rows = await TdbcTemplate.query<{ one: number }>(this.conn, this.parser, MessageCheckpointSql.hasCheckpoint, { sessionId, messageId });
        return rows.length > 0;
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.hasAnyCheckpointForSession 端口方法；内联会把 SQL 搬进调用层。 */
    async hasAnyCheckpointForSession(sessionId: string): Promise<boolean> {
        const rows = await TdbcTemplate.query<{ one: number }>(this.conn, this.parser, MessageCheckpointSql.hasAnyCheckpointForSession, { sessionId });
        return rows.length > 0;
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.countCheckpointsForMessages 端口方法；内联会把分块计数 SQL 搬进调用层。 */
    async countCheckpointsForMessages(sessionId: string, messageIds: ReadonlyArray<string>): Promise<number> {
        if (messageIds.length === 0) {
            return 0;
        }
        // 分块求和：每条消息至多一行（PK + insertCheckpoint 替换语义），
        // COUNT(*) 即有 checkpoint 的消息数；id 列表来自 chat_message 主键、无重复
        // ⇒ 各块之和 == 整段计数。
        let total = 0;
        for (const chunk of chunkIdList(messageIds)) {
            const rows = await TdbcTemplate.query<{ n: number }>(this.conn, this.parser, MessageCheckpointSql.countCheckpointsForMessages, { sessionId, ids: chunk });
            // COUNT(*) 恒返回一行；SQLite 下 COUNT 结果是 INTEGER，Number() 安全。
            total += Number(rows[0]!.n);
        }
        return total;
    }

    async insertCheckpoint(input: MessageCheckpointInsertInput): Promise<void> {
        const revisionRepo = new SqliteVfsRevisionRepository(this.conn);

        const oldRows = await TdbcTemplate.query(this.conn, this.parser, MessageCheckpointSql.insertCheckpointSelectOldFiles, { sessionId: input.sessionId, messageId: input.messageId });
        if (oldRows.length > 0) {
            const oldPointers = oldRows.map((row) => rowToFilePointer(row));
            await RevisionRefCount.decrementForCheckpointFiles(revisionRepo, oldPointers);
        }

        await TdbcTemplate.execute(this.conn, this.parser, MessageCheckpointSql.insertCheckpointDeleteOldFiles, { sessionId: input.sessionId, messageId: input.messageId });
        await TdbcTemplate.execute(this.conn, this.parser, MessageCheckpointSql.insertCheckpointDeleteCheckpoint, { sessionId: input.sessionId, messageId: input.messageId });
        await TdbcTemplate.execute(this.conn, this.parser, MessageCheckpointSql.insertCheckpointInsertCheckpoint, {
            sessionId: input.sessionId,
            messageId: input.messageId,
            createdAtMs: input.createdAtMs,
        });
        // 批量 INSERT message_checkpoint_file——原来逐条 executeTemplate 在文件多时
        // 会变成 N 次 SQL 往返，seed-fork 500 消息 × 200 文件就是 10 万次，相当卡。
        // 这里切到 conn.batch（位置占位符 ?），一次调用处理整批。
        if (input.files.length > 0) {
            const paramsList = input.files.map((f) => [input.sessionId, input.messageId, f.entryId, f.revisionVersion, f.path]);
            await this.conn.batch(MessageCheckpointSql.insertCheckpointInsertFiles, paramsList);
        }

        if (input.files.length > 0) {
            const insertedPointers = input.files.map((file) => ({ entryId: file.entryId, revisionVersion: file.revisionVersion }));
            await RevisionRefCount.incrementForCheckpointFiles(revisionRepo, insertedPointers);
        }
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.seedCheckpoints 端口方法；ForkCopySeeder 经端口单点调用，内联会把三表批量 seed SQL 搬进调用层。 */
    async seedCheckpoints(sessionId: string, messages: ReadonlyArray<{ readonly id: string }>, files: ReadonlyArray<{ readonly entryId: number; readonly revisionVersion: number; readonly path: string }>, createdAtMs: number): Promise<void> {
        if (messages.length === 0 || files.length === 0) {
            return;
        }

        const msgCount = messages.length;

        // 多值 INSERT 分块：逐行 conn.batch 在驱动层是逐行 JSI 往返
        //（better-sqlite3 / op-sqlite 均如此），消息数×文件数平方级行数时
        //（200 文件 × 500 消息 = 10 万行）往返开销淹没 SQLite 本身。改为
        // 每 chunk 一条多值 INSERT，往返次数从 O(行数) 降到 O(行数/块)。
        // 块大小按 900 变量上限切（≤999，老版 SQLITE_MAX_VARIABLE_NUMBER 也安全）。
        const checkpointRows = messages.map((m) => [sessionId, m.id, createdAtMs]);
        await insertMultiValues(this.conn, this.parser, MessageCheckpointSql.seedCheckpointsInsertCheckpoints, checkpointRows);
        const fileRows: unknown[][] = [];
        for (const msg of messages) {
            for (const file of files) {
                fileRows.push([sessionId, msg.id, file.entryId, file.revisionVersion, file.path]);
            }
        }
        await insertMultiValues(this.conn, this.parser, MessageCheckpointSql.seedCheckpointsInsertFiles, fileRows);

        // 批量递增 ref_count：每个文件指针的 revision ref_count 加 msgCount。
        // 直接用 IN 子句 + 固定 delta，比 expand 成 N 份再调 batchAdjustRefCount 更高效——
        // 不需要构造 100,000 元素的数组，也不需要逐条存在性查询（seed 场景 revision 刚 append 完）。
        const revisionRepo = new SqliteVfsRevisionRepository(this.conn);
        const pointers = files.map((f) => ({
            entryId: f.entryId,
            version: f.revisionVersion,
        }));
        // 复用 batchAdjustRefCount 的存在性校验（守护 NOT_FOUND 不变量）
        await revisionRepo.batchAdjustRefCountWithDelta(pointers, msgCount);
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.loadFileTree 端口方法；回滚主链走 loadFilePointerTree，生产零调用，但端口契约仍在且端口文件不在本轮范围，测试经端口直接覆盖。 */
    async loadFileTree(sessionId: string, messageId: string): Promise<Map<string, number> | null> {
        const pointers = await this.loadFilePointerTree(sessionId, messageId);
        if (pointers == null) {
            return null;
        }
        const tree = new Map<string, number>();
        for (const [path, pointer] of pointers) {
            tree.set(path, pointer.revisionVersion);
        }
        return tree;
    }

    async loadFilePointerTree(sessionId: string, messageId: string): Promise<Map<string, CheckpointFilePointer> | null> {
        const has = await this.hasCheckpoint(sessionId, messageId);
        if (!has) {
            return null;
        }
        // LEFT JOIN 取现路径兜底：path 快照非 NULL 时优先（entry 已删仍保留进
        // targetTree，这是 rollback-restore-deleted-entry 的修复核心）；快照 NULL
        // 的存量行回退现路径（rename 后跟随新路径，等同旧 JOIN 形态行为）；
        // 两者皆 NULL（entry 已删且无快照）跳过——无路径可寻址，无法恢复。
        const rows = await TdbcTemplate.query<{ snapshot_path: string | null; live_path: string | null; entry_id: number; revision_version: number }>(this.conn, this.parser, MessageCheckpointSql.loadFilePointerTree, { sessionId, messageId });
        const tree = new Map<string, CheckpointFilePointer>();
        for (const row of rows) {
            const path = row.snapshot_path ?? row.live_path;
            if (path == null) {
                continue;
            }
            tree.set(String(path), {
                path: String(path),
                entryId: Number(row.entry_id),
                revisionVersion: Number(row.revision_version),
            });
        }
        return tree;
    }

    async findCheckpointMessageIdAtOrBefore(sessionId: string, maxSeq: number): Promise<string | null> {
        const rows = await TdbcTemplate.query<{ message_id: string }>(this.conn, this.parser, MessageCheckpointSql.findCheckpointMessageIdAtOrBefore, { sessionId, maxSeq });
        return rows.length === 0 ? null : String(rows[0]!.message_id);
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.findLastCheckpointedMessageId 端口方法；内联会把查询 SQL 搬进调用层。 */
    async findLastCheckpointedMessageId(sessionId: string): Promise<string | null> {
        // 形态照抄 findCheckpointMessageIdAtOrBefore，只是去掉 `cm.seq <= #{maxSeq}`
        // 条件（不拿 Number.MAX_SAFE_INTEGER 顶替——那会把一个巨大数字绑进模板，
        // 且与该方法的语义耦合）。
        const rows = await TdbcTemplate.query<{ message_id: string }>(this.conn, this.parser, MessageCheckpointSql.findLastCheckpointedMessageId, { sessionId });
        return rows.length === 0 ? null : String(rows[0]!.message_id);
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.listFilePointersForSession 端口方法；内联会把查询 SQL 搬进调用层。 */
    async listFilePointersForSession(sessionId: string): Promise<ReadonlyArray<MessageCheckpointFile>> {
        const rows = await TdbcTemplate.query(this.conn, this.parser, MessageCheckpointSql.listFilePointersForSession, { sessionId });
        return rows.map((row) => rowToFilePointer(row));
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.listDistinctCheckpointPointersForSession 端口方法；生产零调用，但端口契约仍在且端口文件不在本轮范围，测试经端口直接覆盖。 */
    async listDistinctCheckpointPointersForSession(sessionId: string): Promise<ReadonlyArray<MessageCheckpointDistinctPointer>> {
        const rows = await TdbcTemplate.query<{ entry_id: number; revision_version: number }>(this.conn, this.parser, MessageCheckpointSql.listDistinctCheckpointPointersForSession, { sessionId });
        return rows.map((row) => ({
            entryId: Number(row.entry_id),
            revisionVersion: Number(row.revision_version),
        }));
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.listFilePointersForMessages 端口方法；内联会把查询 SQL 搬进调用层。 */
    async listFilePointersForMessages(sessionId: string, messageIds: ReadonlyArray<string>): Promise<ReadonlyArray<MessageCheckpointFile>> {
        if (messageIds.length === 0) {
            return [];
        }
        // 分块顺序 concat：块顺序 == id 顺序 ⇒ 返回行集合与顺序都与整段版一致。
        const out: MessageCheckpointFile[] = [];
        for (const chunk of chunkIdList(messageIds)) {
            const rows = await TdbcTemplate.query(this.conn, this.parser, MessageCheckpointSql.listFilePointersForMessages, { sessionId, ids: chunk });
            for (const row of rows) {
                out.push(rowToFilePointer(row));
            }
        }
        return out;
    }

    async deleteCheckpointsForMessages(sessionId: string, messageIds: ReadonlyArray<string>): Promise<void> {
        if (messageIds.length === 0) {
            return;
        }
        const revisionRepo = new SqliteVfsRevisionRepository(this.conn);
        // 顺序不许变：先**逐块读完** message_checkpoint_file 行并 concat，
        // 一次性 RevisionRefCount.decrementForCheckpointFiles（ref −1 必须先于行删除），
        // 再逐块执行那两条 DELETE。块内读失败会抛 ⇒ 整批不动（调用方在事务内）。
        const fileRows: MessageCheckpointFile[] = [];
        const chunks = [...chunkIdList(messageIds)];
        for (const chunk of chunks) {
            const rows = await TdbcTemplate.query(this.conn, this.parser, MessageCheckpointSql.deleteCheckpointsForMessagesSelectFiles, { sessionId, ids: chunk });
            for (const row of rows) {
                fileRows.push(rowToFilePointer(row));
            }
        }
        if (fileRows.length > 0) {
            await RevisionRefCount.decrementForCheckpointFiles(revisionRepo, fileRows);
        }

        for (const chunk of chunks) {
            await TdbcTemplate.execute(this.conn, this.parser, MessageCheckpointSql.deleteCheckpointsForMessagesDeleteFiles, { sessionId, ids: chunk });
            await TdbcTemplate.execute(this.conn, this.parser, MessageCheckpointSql.deleteCheckpointsForMessagesDeleteCheckpoints, { sessionId, ids: chunk });
        }
    }

    /** nm-style: keep-public — 实现 MessageCheckpointRepository.deleteCheckpointsForSession 端口方法；内联会把多表删除 + ref 递减搬进调用层。 */
    async deleteCheckpointsForSession(sessionId: string): Promise<void> {
        const revisionRepo = new SqliteVfsRevisionRepository(this.conn);
        const fileRows = await TdbcTemplate.query(this.conn, this.parser, MessageCheckpointSql.deleteCheckpointsForSessionSelectFiles, { sessionId });
        if (fileRows.length > 0) {
            const pointers = fileRows.map((row) => rowToFilePointer(row));
            await RevisionRefCount.decrementForCheckpointFiles(revisionRepo, pointers);
        }

        await TdbcTemplate.execute(this.conn, this.parser, MessageCheckpointSql.deleteCheckpointsForSessionDeleteFiles, { sessionId });
        await TdbcTemplate.execute(this.conn, this.parser, MessageCheckpointSql.deleteCheckpointsForSessionDeleteCheckpoints, { sessionId });
    }
}
