/**
 * {@link BaseOpSqliteAdapter} 与 {@link OpSqliteDriver} 单元测试
 * （fake bindings 为 op-sqlite 连接对象形状）。
 *
 * @module tdbc-driver-op-sqlite/test/op-sqlite.adapter
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BaseOpSqliteAdapter, type OpSqliteBindings } from "../src/impl/op-sqlite.adapter.js";
import { OpSqliteDriver } from "../src/driver.js";

/** op-sqlite 原生结果形状（metadata 为 {name, type, index}）。 */
type RawResult = {
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
  insertId?: number;
  columnNames?: string[];
  metadata?: { name: string; type: string; index: number }[];
};

type RecordedCall = { sql: string; params?: unknown[] };

/** fake DB：连接对象形状（execute 异步 / executeSync 同步 / close / getDbPath 实例方法）。 */
function makeFakeDb(options: { raw?: RawResult; path?: string } = {}) {
  const state = {
    asyncCalls: [] as RecordedCall[],
    syncCalls: [] as RecordedCall[],
    closed: false,
  };
  const raw = options.raw ?? {};
  return {
    state,
    execute: async (sql: string, params?: unknown[]): Promise<RawResult> => {
      state.asyncCalls.push({ sql, params });
      return raw;
    },
    executeSync: (sql: string, params?: unknown[]): RawResult => {
      state.syncCalls.push({ sql, params });
      return raw;
    },
    close: () => {
      state.closed = true;
    },
    getDbPath: () => options.path ?? "/data/default/novel_master_vfs",
  };
}

/** fake bindings：op-sqlite 模块形状（open + 平台路径常量）。 */
function makeFakeBindings(options: {
  db: ReturnType<typeof makeFakeDb>;
  openImpl?: OpSqliteBindings["open"];
  androidFilesPath?: string | null;
  iosDocumentPath?: string | null;
}) {
  const openCalls: { name: string; location?: string; failOnCreate?: boolean }[] = [];
  const bindings: OpSqliteBindings & { openCalls: typeof openCalls } = {
    open: options.openImpl ?? ((opts) => {
      openCalls.push(opts);
      return options.db as unknown as ReturnType<OpSqliteBindings["open"]>;
    }),
    ANDROID_FILES_PATH: options.androidFilesPath ?? null,
    IOS_DOCUMENT_PATH: options.iosDocumentPath ?? null,
    openCalls,
  };
  return bindings;
}

describe("BaseOpSqliteAdapter", () => {
  it("opens and closes the DB connection object", async () => {
    const db = makeFakeDb();
    const bindings = makeFakeBindings({ db });

    const adapter = new BaseOpSqliteAdapter(bindings);
    await adapter.open({ name: "novel_master_vfs", location: "default" });

    // undefined 键不应传给原生层（C++ 侧 hasProperty 后直接 asString/asBool，
    // 键存在但值为 undefined 会抛 JSI 错误）。
    assert.deepEqual(bindings.openCalls, [
      { name: "novel_master_vfs", location: "default" },
    ]);

    await adapter.close();
    assert.equal(db.state.closed, true);
  });

  it("routes execute to async db.execute and executeSync to db.executeSync", async () => {
    const db = makeFakeDb();
    const adapter = new BaseOpSqliteAdapter(makeFakeBindings({ db }));

    await adapter.open({ name: "testdb" });
    await adapter.execute("INSERT INTO t VALUES (?)", [7]);
    adapter.executeSync("SELECT 1", []);

    assert.deepEqual(db.state.asyncCalls, [
      { sql: "INSERT INTO t VALUES (?)", params: [7] },
    ]);
    assert.deepEqual(db.state.syncCalls, [{ sql: "SELECT 1", params: [] }]);
  });

  it("converts metadata {name,type,index} to {columnName} and passes rows through", async () => {
    const db = makeFakeDb({
      raw: {
        rows: [{ path: "/dev/note.md" }],
        rowsAffected: 1,
        columnNames: ["path"],
        metadata: [{ name: "path", type: "TEXT", index: 0 }],
      },
    });
    const adapter = new BaseOpSqliteAdapter(makeFakeBindings({ db }));

    await adapter.open({ name: "testdb" });
    const result = await adapter.execute("SELECT path FROM files");

    // rows 纯数组直接透传；metadata 字段名转换集中在此处完成。
    assert.deepEqual(result.rows, [{ path: "/dev/note.md" }]);
    assert.deepEqual(result.metadata, [{ columnName: "path" }]);
    assert.deepEqual(result.columnNames, ["path"]);
    assert.equal(result.rowsAffected, 1);
  });

  it("forwards failOnCreate and exposes legacy default dir and db path", async () => {
    const db = makeFakeDb({ path: "/files/default/novel_master_vfs" });
    const bindings = makeFakeBindings({
      db,
      androidFilesPath: "/files",
      iosDocumentPath: null,
    });

    const adapter = new BaseOpSqliteAdapter(bindings);
    await adapter.open({ name: "novel_master_vfs", location: "/files/default", failOnCreate: true });

    assert.deepEqual(bindings.openCalls, [
      { name: "novel_master_vfs", location: "/files/default", failOnCreate: true },
    ]);
    // Android 布局：<files>/default；iOS 常量为 null 时取 Android。
    assert.equal(adapter.getLegacyDefaultDir!(), "/files/default");
    assert.equal(adapter.getDbPath!(), "/files/default/novel_master_vfs");
  });

  it("falls back to IOS_DOCUMENT_PATH when ANDROID_FILES_PATH is null", () => {
    const bindings = makeFakeBindings({
      db: makeFakeDb(),
      androidFilesPath: null,
      iosDocumentPath: "/var/mobile/Documents",
    });
    const adapter = new BaseOpSqliteAdapter(bindings);

    assert.equal(adapter.getLegacyDefaultDir!(), "/var/mobile/Documents/default");
  });

  it("returns undefined legacy dir when no platform constant is available", () => {
    const adapter = new BaseOpSqliteAdapter(makeFakeBindings({ db: makeFakeDb() }));
    assert.equal(adapter.getLegacyDefaultDir!(), undefined);
  });
});

describe("OpSqliteDriver.open (legacy layout probe)", () => {
  it("probes the legacy quick-sqlite layout with failOnCreate before defaulting", async () => {
    const db = makeFakeDb();
    const bindings = makeFakeBindings({
      db,
      androidFilesPath: "/data/user/0/app/files",
    });

    const driver = new OpSqliteDriver(new BaseOpSqliteAdapter(bindings));
    await driver.open({ filename: "novel_master_vfs", driver: "op-sqlite" });

    // 只有一次 open：直接命中旧布局（绝对路径 + failOnCreate: true）。
    assert.deepEqual(bindings.openCalls, [
      {
        name: "novel_master_vfs",
        location: "/data/user/0/app/files/default",
        failOnCreate: true,
      },
    ]);
    // PRAGMA 双保险都执行了。
    const pragmas = db.state.asyncCalls.map((c) => c.sql);
    assert.ok(pragmas.includes("PRAGMA foreign_keys = ON"));
    assert.ok(pragmas.includes("PRAGMA temp_store = MEMORY"));
  });

  it("falls back to the default layout when the legacy file is absent", async () => {
    const db = makeFakeDb();
    const bindings = makeFakeBindings({
      db,
      androidFilesPath: "/data/user/0/app/files",
      openImpl: (opts) => {
        bindings.openCalls.push(opts);
        if (opts.failOnCreate) {
          // 模拟旧文件不存在：failOnCreate 下 open 抛错而非新建空库。
          throw new Error("unable to open database file");
        }
        return db as unknown as ReturnType<OpSqliteBindings["open"]>;
      },
    });

    const driver = new OpSqliteDriver(new BaseOpSqliteAdapter(bindings));
    await driver.open({ filename: "novel_master_vfs", driver: "op-sqlite" });

    assert.deepEqual(bindings.openCalls, [
      {
        name: "novel_master_vfs",
        location: "/data/user/0/app/files/default",
        failOnCreate: true,
      },
      { name: "novel_master_vfs" },
    ]);
  });

  it("skips the probe when an explicit location is given", async () => {
    const bindings = makeFakeBindings({
      db: makeFakeDb(),
      androidFilesPath: "/data/user/0/app/files",
    });

    const driver = new OpSqliteDriver(new BaseOpSqliteAdapter(bindings));
    await driver.open({
      filename: "novel_master_vfs",
      driver: "op-sqlite",
      location: "custom",
    });

    assert.deepEqual(bindings.openCalls, [
      { name: "novel_master_vfs", location: "custom" },
    ]);
  });
});
