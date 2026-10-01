/**
 * 包一层 {@link TdbcConnection} 观测「事务调用次数 + 每条事务内发了哪些语句」。
 *
 * 用途：Wave C 的分片/短事务系列（CS-05 导入分片、CS-05b backfill 移出事务）
 * 的验收口径一律是**计数式**——「事务被调了几次」「某条事务里有没有 `vfs_entry`
 * 写」。RULE 明确禁掉 `spyListBySession` 这类「给读路径换实现就静默失效」的
 * 观测面，改用「事务回调 + 语句清单」这一结构上稳定的观测面。
 *
 * 与 {@link ./sql-counting-connection.ts} 的分工：那边数**全部** SQL（不区分是否
 * 在事务内），这边数**事务**并把语句按所属事务归组。两者可以叠用。
 *
 * @module test/helpers/transaction-probe
 */

import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";

/** 一条被记录下来的语句。 */
export interface ProbedStatement {
  /** 所属事务的序号（0 起）；`null` 表示在事务之外执行。 */
  readonly txIndex: number | null;
  /** 调用入口。 */
  readonly via: "execute" | "query" | "batch";
  /** 原始 SQL（trim 过）。 */
  readonly sql: string;
  /** 位置参数个数（`batch` 取单组长度）。 */
  readonly paramCount: number;
}

/** 事务探针记录器。 */
export class TransactionProbe {
  /** 事务按开始顺序编号（0 起）。 */
  transactionCount = 0;

  private readonly statements: ProbedStatement[] = [];

  /** 事务结束时回调（用于记录该事务抛错/正常）。 */
  readonly transactions: Array<{ index: number; failed: boolean }> = [];

  record(
    txIndex: number | null,
    via: ProbedStatement["via"],
    sql: string,
    paramCount: number
  ): void {
    this.statements.push({ txIndex, via, sql: sql.trim(), paramCount });
  }

  /** 全部已记录语句。 */
  all(): readonly ProbedStatement[] {
    return this.statements;
  }

  /** 第 index 条事务内发出的语句。 */
  statementsInTransaction(index: number): readonly ProbedStatement[] {
    return this.statements.filter((s) => s.txIndex === index);
  }

  /** 第 index 条事务内的语句数。 */
  statementCountInTransaction(index: number): number {
    return this.statementsInTransaction(index).length;
  }

  /** 事务之外的语句（按进入顺序）。 */
  statementsOutsideTransactions(): readonly ProbedStatement[] {
    return this.statements.filter((s) => s.txIndex === null);
  }

  /** 清空记录（bootstrap / 造夹具阶段之后调用）。 */
  reset(): void {
    this.statements.length = 0;
    this.transactionCount = 0;
    this.transactions.length = 0;
  }
}

/**
 * 用 {@link TransactionProbe} 装饰一条连接。
 *
 * ⚠️ 事务**内**的语句会同时经过内层实现自己发的 `BEGIN`/`COMMIT`——那些不进
 * 探针（探针只包业务调用面），所以 `statementCountInTransaction` 统计的是
 * 「业务语句数」，这正是验收想要的量。
 */
export function probeTransactions(inner: TdbcConnection): {
  conn: TdbcConnection;
  probe: TransactionProbe;
} {
  const probe = new TransactionProbe();
  let current: number | null = null;

  const wrap = (target: TdbcConnection): TdbcConnection => ({
    execute: (sql, parameters) => {
      probe.record(current, "execute", sql, parameters?.length ?? 0);
      return target.execute(sql, parameters);
    },
    query: <T extends Record<string, unknown>>(
      sql: string,
      parameters?: readonly unknown[]
    ) => {
      probe.record(current, "query", sql, parameters?.length ?? 0);
      return target.query<T>(sql, parameters);
    },
    batch: (sql, parametersList) => {
      probe.record(
        current,
        "batch",
        sql,
        parametersList[0]?.length ?? 0
      );
      return target.batch(sql, parametersList);
    },
    // 嵌套事务本仓不存在（NESTED_TRANSACTION 会抛），保持直通语义。
    transaction: <U>(fn: (tx: TdbcConnection) => Promise<U>) =>
      target.transaction(fn),
    close: () => target.close(),
  });

  const outer = wrap(inner);

  const conn: TdbcConnection = {
    execute: (sql, parameters) => outer.execute(sql, parameters),
    query: (sql, parameters) => outer.query(sql, parameters),
    batch: (sql, parametersList) => outer.batch(sql, parametersList),
    async transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
      const index = probe.transactionCount++;
      const previous = current;
      current = index;
      const slot = { index, failed: false };
      probe.transactions.push(slot);
      try {
        return await inner.transaction((tx) => fn(wrap(tx)));
      } catch (error) {
        slot.failed = true;
        throw error;
      } finally {
        current = previous;
      }
    },
    close: () => inner.close(),
  };

  return { conn, probe };
}