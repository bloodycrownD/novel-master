/**
 * 包一层 {@link TdbcConnection} 统计业务 SQL 执行次数的测试 helper。
 *
 * 用途：N+1 性能修复的回归测试（T-DEL1 / T-SC1 / T-FK2 …）要断言某操作发出的 SQL
 * 总数或某类语句数。这里给 `execute` / `query` / `batch` 各埋一个计数点，所有
 * SQL（含 `transaction` 内部转发的）都会被记下来。
 *
 * 设计刻意保持轻量：只数次数 + 保留原始 SQL 文本（已 trim）供断言按前缀分类，
 * 不做耗时采集——耗时相关的热点分析交给 `sql-cr-validation` worktree 里那套
 * `InstrumentedTdbcConnection + SqlRecorder + SqlReport`。这套是它的精简版，
 * 只为「次数上限」这类断言服务。
 *
 * @module test/helpers/sql-counting-connection
 */

import {  NovelMasterBootstrap, createPersistentPreferences, PersistentStateFactory, SerializationDecode, TdbcOpen, type PersistentPreferences, type PersistentState, type TdbcConnection  } from "@novel-master/core";
import {  agentDefinitionSchema, AgentServiceFactory, type AgentRegistryService  } from "@novel-master/core/agent";
import {  ChatServiceFactory, type MessageService, type ProjectService, type SessionService  } from "@novel-master/core/chat";
import {  SqliteProjectRepository  } from "../../src/domain/chat/repositories/impl/sqlite-project.repository.js";
import {  SqliteSessionRepository  } from "../../src/domain/chat/repositories/impl/sqlite-session.repository.js";
import {  SqliteMessageRepository  } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {  SqliteVfsEntryRepository  } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {  DefaultProjectService  } from "../../src/service/chat/impl/project.service.js";
import {  DefaultSessionService  } from "../../src/service/chat/impl/session.service.js";
import {  MessageCheckpointFactory, type MessageCheckpointService  } from "@novel-master/core/message-checkpoint";
import {  SessionFsServiceFactory, type SessionFsService  } from "@novel-master/core/session-fs";
import {  SessionKkvServiceFactory, type SessionKkvService  } from "@novel-master/core/session-kkv";
import {  VfsServiceFactory, type VfsService  } from "@novel-master/core/vfs";
import {  BETTER_SQLITE3_DRIVER_NAME, BetterSqlite3Register  } from "@novel-master/tdbc-driver-better-sqlite3";

import type { NovelMasterTestContext } from "./novel-master.js";

/** 单条已记录的 SQL。 */
export interface RecordedSql {
  /** 原始 SQL 文本（已 trim）。 */
  readonly sql: string;
  /** SQL 开头的大写关键字（SELECT / INSERT / UPDATE / DELETE / BEGIN / COMMIT / PRAGMA …）。 */
  readonly kind: string;
  /** 调用入口：execute / query / batch。 */
  readonly via: "execute" | "query" | "batch";
}

/**
 * SQL 计数器：和 {@link CountingTdbcConnection} 一对一，记录所有经过 conn 的语句。
 *
 * 不做去重——同一个 prepared 语句发 N 次就是 N 条记录，正是 N+1 要抓的东西。
 */
export class SqlCounter {
  private readonly records: RecordedSql[] = [];

  /** 记一条 SQL。 */
  record(via: RecordedSql["via"], sql: string): void {
    const trimmed = sql.trim();
    const kind = (trimmed.match(/^\s*([A-Za-z]+)/)?.[1] ?? "UNKNOWN").toUpperCase();
    this.records.push({ sql: trimmed, kind, via });
  }

  /** 已记录的 SQL 总数。 */
  count(): number {
    return this.records.length;
  }

  /** 按关键字（SELECT / INSERT / UPDATE / DELETE / BEGIN / COMMIT …）计数。 */
  countByKind(kind: string): number {
    const upper = kind.toUpperCase();
    return this.records.filter((r) => r.kind === upper).length;
  }

  /**
   * 按子串筛选的调用次数之和。
   *
   * 同一类操作可能因分块 / 不同分支产生多条不同文本的 SQL，用子串聚合更稳——
   * 比如所有查 `vfs_content_blob` 的 SELECT 都含 `FROM vfs_content_blob`，
   * 所有删 `vfs_entry` 的 DELETE 都含 `DELETE FROM vfs_entry`。
   */
  countBySubstring(needle: string): number {
    return this.records.filter((r) => r.sql.includes(needle)).length;
  }

  /** 已记录的全部 SQL（只读视图）。 */
  all(): readonly RecordedSql[] {
    return this.records;
  }

  /** 清空记录，用于分阶段采集（例如 bootstrap 后清掉 DDL）。 */
  clear(): void {
    this.records.length = 0;
  }
}

/**
 * 装饰 {@link TdbcConnection}，把 `execute` / `query` / `batch` 转发给内层 conn，
 * 同时在 {@link SqlCounter} 里记一条。
 *
 * `transaction(fn)` 把一个「在 inner 的事务连接上执行但仍被计数」的包装传给 fn，
 * 这样嵌套事务场景（service 层 `runInTransactionOrConn` 的 NESTED_TRANSACTION 分支）
 * 计数也不会丢。
 */
export class CountingTdbcConnection implements TdbcConnection {
  constructor(
    private readonly inner: TdbcConnection,
    private readonly counter: SqlCounter,
  ) {}

  execute(sql: string, parameters?: readonly unknown[]) {
    this.counter.record("execute", sql);
    return this.inner.execute(sql, parameters);
  }

  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ) {
    this.counter.record("query", sql);
    return this.inner.query<T>(sql, parameters);
  }

  batch(sql: string, parametersList: readonly (readonly unknown[])[]) {
    // batch 一次原生调用对应一条 SQL 模板（参数多组），按「一条」计数——
    // 这正是 batch 相对逐条 execute 的优化点：N 组参数压成 1 条记录。
    this.counter.record("batch", sql);
    return this.inner.batch(sql, parametersList);
  }

  async transaction<T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> {
    return this.inner.transaction((txInner) => {
      const wrapped: TdbcConnection = {
        execute: (sql, p) => {
          this.counter.record("execute", sql);
          return txInner.execute(sql, p);
        },
        query: <U extends Record<string, unknown> = Record<string, unknown>>(
          sql: string,
          p?: readonly unknown[],
        ) => {
          this.counter.record("query", sql);
          return txInner.query<U>(sql, p);
        },
        batch: (sql, pl) => {
          this.counter.record("batch", sql);
          return txInner.batch(sql, pl);
        },
        transaction: <U>(nested: (tx: TdbcConnection) => Promise<U>) =>
          txInner.transaction(nested),
        close: () => txInner.close(),
      };
      return fn(wrapped);
    });
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/**
 * 复刻 `openNovelMasterTestConnection()`，但在 `TdbcOpen.open()` 返回的 conn 外面包一层
 * {@link CountingTdbcConnection}，再拿去 bootstrap 和建 services——和业务侧
 * `InstrumentedTdbcConnection` 的套路一致：services 在构造时就持有 conn 引用，
 * 必须从 open 那一步就包好。
 *
 * 返回的 `ctx.conn` 就是装饰过的版本，`counter` 和它一对一。
 */
export async function openSqlCountingNovelMasterTestConnection(): Promise<
  NovelMasterTestContext & { readonly counter: SqlCounter }
> {
  BetterSqlite3Register.register();
  const rawConn = await TdbcOpen.open("tdbc:sqlite:file::memory:", {
    driver: BETTER_SQLITE3_DRIVER_NAME,
    filename: ":memory:",
  });

  const counter = new SqlCounter();
  const conn: TdbcConnection = new CountingTdbcConnection(rawConn, counter);

  await NovelMasterBootstrap.bootstrap(conn);
  const state = PersistentStateFactory.create(conn);
  const agentRegistry = AgentServiceFactory.createRegistry(conn, state);
  await agentRegistry.upsert(
    "test-default-agent",
    SerializationDecode.decode(
      {
        schemaVersion: 1,
        name: "测试默认 Agent",
        prompts: { persist: {}, dynamic: {} },
      },
      agentDefinitionSchema,
    ),
  );
  await state.setCurrentAgentId("test-default-agent");

  const projectRepo = new SqliteProjectRepository(conn);
  const sessionRepo = new SqliteSessionRepository(conn);
  const messageRepo = new SqliteMessageRepository(conn);
  const vfsRepo = new SqliteVfsEntryRepository(conn);

  return {
    conn,
    counter,
    state,
    agentRegistry,
    preferences: createPersistentPreferences(conn),
    projects: new DefaultProjectService({ conn, projects: projectRepo, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo }),
    sessions: new DefaultSessionService({ conn, projects: projectRepo, sessions: sessionRepo, messages: messageRepo, vfs: vfsRepo, state, agentRegistry }),
    messages: ChatServiceFactory.createMessage(conn),
    sessionFs: SessionFsServiceFactory.create(conn),
    messageCheckpoint: MessageCheckpointFactory.create(conn),
    sessionKkv: SessionKkvServiceFactory.create(conn),
    globalVfs: () => VfsServiceFactory.createScoped(conn, { kind: "global" }),
    projectVfs: (projectId) =>
      VfsServiceFactory.createScoped(conn, { kind: "project", projectId }),
    sessionVfs: (projectId, sessionId) =>
      VfsServiceFactory.createScoped(conn, {
        kind: "session",
        projectId,
        sessionId,
      }),
    globalMetaVfs: () => VfsServiceFactory.createScoped(conn, { kind: "global-meta" }),
    projectMetaVfs: (projectId) =>
      VfsServiceFactory.createScoped(conn, { kind: "project-meta", projectId }),
  };
}

export type {
  AgentRegistryService,
  MessageService,
  MessageCheckpointService,
  PersistentPreferences,
  PersistentState,
  ProjectService,
  SessionFsService,
  SessionKkvService,
  SessionService,
  VfsService,
};
