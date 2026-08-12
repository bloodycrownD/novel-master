/**
 * 轻量 SQL 计数装饰器：包在真实 TdbcConnection 外面，按 SQL 文本统计
 * execute/query/batch 的调用次数，给 N+1 修复测试断言"SELECT/DELETE 次数"用。
 *
 * 和 sql-cr-audit harness 的 InstrumentedTdbcConnection 区别在于：这里只计数、
 * 不计时、不生成 report，纯粹为 T-SC1 / T-DEL2 / T-GC2 这类"次数上限"断言服务。
 *
 * @module test/vfs/n-plus-1-counting-connection
 */

import type {
  BatchResult,
  ExecuteResult,
  Row,
  TdbcConnection,
} from "@novel-master/core";

/**
 * 按 SQL 文本（归一化后）聚合的调用次数。
 *
 * key 用 SQL 文本本身——本项目 SQL 都用 `?` 占位，参数不拼进文本，
 * 同一条 prepared statement 的不同参数自然聚到同一个 key 下。
 */
export class SqlCounter {
  readonly #counts = new Map<string, number>();

  /** 记一次调用。 */
  record(sql: string): void {
    this.#counts.set(sql, (this.#counts.get(sql) ?? 0) + 1);
  }

  /** 清空，便于分阶段采集（比如 bootstrap 后清掉 DDL）。 */
  clear(): void {
    this.#counts.clear();
  }

  /** 所有被记录的 SQL 文本（只读视图）。 */
  entries(): ReadonlyMap<string, number> {
    return this.#counts;
  }

  /**
   * 按子串筛选的调用次数之和。
   *
   * 同一类操作可能因分块 / 不同分支产生多条不同文本的 SQL，
   * 用子串聚合更稳——比如所有查 vfs_content_blob 的 SELECT 都含
   * `FROM vfs_content_blob`，所有删 vfs_entry 的 DELETE 都含
   * `DELETE FROM vfs_entry`。
   */
  countBySubstring(needle: string): number {
    let total = 0;
    for (const [sql, n] of this.#counts) {
      if (sql.includes(needle)) {
        total += n;
      }
    }
    return total;
  }
}

/**
 * 装饰过的 TdbcConnection：拦截 execute/query/batch 计数，事务体里拿到的
 * tx 也会被包一层（带同一个 counter），保证事务内的 N+1 也能被抓到。
 */
export class CountingConnection implements TdbcConnection {
  constructor(
    private readonly inner: TdbcConnection,
    private readonly counter: SqlCounter,
  ) {}

  async execute(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ExecuteResult> {
    this.counter.record(sql);
    return this.inner.execute(sql, parameters);
  }

  async query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<T[]> {
    this.counter.record(sql);
    return this.inner.query<T>(sql, parameters);
  }

  async batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[],
  ): Promise<BatchResult> {
    this.counter.record(sql);
    return this.inner.batch(sql, parametersList);
  }

  transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
    // 事务体里拿到的 tx 也要计数，否则事务内的 N+1 抓不到。
    return this.inner.transaction((tx) =>
      fn(new CountingConnection(tx, this.counter)),
    );
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
