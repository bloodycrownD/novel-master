/**
 * Desktop 备份导入的吞错治理回归（S-CS-07）+ 换代信号（S-CS-01 Step 1）。
 *
 * 被钉死的三条曾经会静默发生的事：
 * 1. 备份拷贝失败被 `.catch(() => undefined)` 吞掉 ⇒ 覆盖照跑、库文件已是
 *    远端快照而本地未同步的改动无声消失；
 * 2. 回滚失败同样被吞，且 finally 还把唯一可能的回滚副本删掉；
 * 3. 校验 16 字节魔数把整份快照读进 Node 堆。
 *
 * 测试基座是 node:test 零 mock 设施，没有可 patch 的 ESM 具名导入 ⇒
 * 一切注入都走生产代码里的 `__setDbBackupFsOpsForTest` 缝。
 *
 * @module test/db-backup-rollback-safety
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  open as openFileHandle,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  DatabaseReplacedError,
  __setDbBackupFsOpsForTest,
  exportDatabaseBackupToPath,
  importDatabaseBackupFromPath,
} from "../src/main/services/db-backup.service.js";
import {
  getDesktopRuntime,
  rebootstrapDesktopRuntime,
} from "../src/main/runtime/desktop-runtime-singleton.js";
import { resolveDbPath } from "../src/main/runtime/resolve-db-path.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("db-backup 导入吞错治理 (S-CS-07) + 换代信号 (S-CS-01)", () => {
  let tempDir: string;
  let dbPath: string;
  let bakPath: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-backup-rollback-"));
    // 首次 getDesktopRuntime 会懒建出真实的库文件。
    await getDesktopRuntime();
    dbPath = resolveDbPath();
    bakPath = `${dbPath}.nmbackup.bak`;
  });

  after(async () => {
    __setDbBackupFsOpsForTest(null);
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("备份拷贝失败时抛错且不覆盖活动库文件", async () => {
    const runtime = await getDesktopRuntime();
    const src = join(tempDir, "rollback-src.db");
    await exportDatabaseBackupToPath(runtime, src);
    // 造一行「只在本机存在」的内容：覆盖一旦发生就能看出来。
    await runtime.conn.execute(
      "CREATE TABLE IF NOT EXISTS rollback_probe (v TEXT)"
    );
    await runtime.conn.execute(
      "INSERT INTO rollback_probe (v) VALUES ('local-only-row')"
    );
    const before = await readFile(dbPath);
    assert.ok(before.byteLength > 0);

    // Windows 安全的确定性构造：在 bakPath 位置预建一个同名目录 ⇒
    // copyFile(dbPath → bakPath) 必以 EISDIR/EPERM 失败
    // （「目录改只读」在 Windows 上不拦写入，attrib +r 对目录无效）。
    await rm(bakPath, { recursive: true, force: true });
    await mkdir(bakPath, { recursive: true });

    await assert.rejects(
      () => importDatabaseBackupFromPath(src),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(
          error.message,
          /回滚失败/,
          "备份步就失败时不该进回滚分支的措辞",
        );
        return true;
      },
    );

    const after = await readFile(dbPath);
    assert.equal(
      Buffer.from(after).equals(Buffer.from(before)),
      true,
      "备份失败时活动库文件内容必须原样未变",
    );
  });

  it("回滚拷贝失败时错误信息含备份路径且副本保留在磁盘", async () => {
    const runtime = await getDesktopRuntime();
    const src = join(tempDir, "rollback-src2.db");
    await exportDatabaseBackupToPath(runtime, src);
    await rm(bakPath, { recursive: true, force: true });

    const realCopy = copyFile;
    // 注入：覆盖动作（* → dbPath）失败 + 回滚动作（bakPath → dbPath）也失败。
    // 备份步（dbPath → bakPath）必须仍然成功，否则测的就不是回滚分支了。
    __setDbBackupFsOpsForTest({
      copyFile: (async (from: string, to: string) => {
        if (to === dbPath) {
          throw new Error(`注入的拷贝失败: ${from}`);
        }
        return realCopy(from, to);
      }) as unknown as typeof copyFile,
    });
    try {
      await assert.rejects(
        () => importDatabaseBackupFromPath(src),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /回滚失败/);
          assert.ok(
            error.message.includes(bakPath),
            `错误信息必须告诉用户副本在哪: ${error.message}`,
          );
          return true;
        },
      );
    } finally {
      __setDbBackupFsOpsForTest(null);
    }

    assert.equal(
      existsSync(bakPath),
      true,
      "回滚失败时必须保留回滚副本（用户要能手工救回）",
    );
    // 导入链已关掉连接，runtime 作废。
    await rebootstrapDesktopRuntime();
  });

  it("正常导入成功后回滚副本被清理且回报 databaseReplaced", async () => {
    const runtime = await getDesktopRuntime();
    const src = join(tempDir, "rollback-ok.db");
    await exportDatabaseBackupToPath(runtime, src);

    const outcome = await importDatabaseBackupFromPath(src);
    assert.equal(outcome.databaseReplaced, true);
    assert.equal(outcome.providerTablesRestored, true);
    assert.equal(existsSync(bakPath), false, "回滚成功时 bak 冗余，必须清理");
    await rebootstrapDesktopRuntime();
  });

  it("覆盖已成功但收尾失败时抛 DatabaseReplacedError 且不回滚", async () => {
    const runtime = await getDesktopRuntime();
    const src = join(tempDir, "rollback-provider-fail.db");
    await exportDatabaseBackupToPath(runtime, src);
    await rm(bakPath, { recursive: true, force: true });

    // 覆盖动作照常发生，但落进去的是一份「不是数据库」的内容 ⇒
    // 恢复三表用的短连接打不开 ⇒ 收尾失败。
    // 这正是 DatabaseReplacedError 存在的场景：库已换代，**不得回滚**。
    const notADb = join(tempDir, "not-a-db.bin");
    await writeFile(notADb, Buffer.alloc(4096, 0x41));
    const realCopy = copyFile;
    __setDbBackupFsOpsForTest({
      copyFile: (async (from: string, to: string) => {
        if (to === dbPath) {
          return realCopy(notADb, to);
        }
        return realCopy(from, to);
      }) as unknown as typeof copyFile,
    });
    try {
      await assert.rejects(
        () => importDatabaseBackupFromPath(src),
        (error: unknown) => {
          assert.ok(
            error instanceof DatabaseReplacedError,
            `必须是 DatabaseReplacedError，实际: ${String(error)}`,
          );
          assert.equal(error.databaseReplaced, true);
          assert.equal(error.providerTablesRestored, false);
          assert.match(error.message, /服务商配置恢复失败/);
          // 文案必须告诉用户副本在哪——保留了却不报路径，等于把救回机会藏起来。
          assert.ok(
            error.message.includes(bakPath),
            `错误信息必须写出保留副本的路径: ${error.message}`,
          );
          return true;
        },
      );
    } finally {
      __setDbBackupFsOpsForTest(null);
    }

    const current = await readFile(dbPath);
    assert.equal(
      current.equals(await readFile(notADb)),
      true,
      "覆盖已成功后不得回滚（回滚会把用户拉回来的数据丢掉）",
    );
    // 牙齿（CR-F01）：不改这一段时 finally 照常 unlink(bakPath)，
    // 删掉的正是「导入前的完整旧库」——用户未同步的本地改动在磁盘上就此消失，
    // 而错误文案只字未提。本断言与终态③的不可回滚性互为前提。
    assert.equal(
      existsSync(bakPath),
      true,
      "终态③必须保留导入前的旧库副本（唯一一份含未同步本地改动的文件）",
    );

    // 把库恢复成可用状态——本用例故意留下一份垃圾库文件，
    // 后续 rebootstrap / teardown 都会被它噎住。
    await copyFile(src, dbPath);
    await rebootstrapDesktopRuntime();
  });

  it("assertSqliteFileAtPath 只读前 16 字节（不整包读入）", async () => {
    // 确定性断言：把 read 的实参钉成 (buf, 0, 16, 0)。把实现整段换成整包
    // readFile 必红（那时根本没有 handle.read，只有 fsOps.open）。
    const notSqlite = join(tempDir, "not-sqlite.nmbackup");
    await writeFile(notSqlite, Buffer.alloc(4096, 0x5a));

    const reads: unknown[][] = [];
    const realOpen = openFileHandle as unknown as (
      ...a: unknown[]
    ) => Promise<{ read: (...a: unknown[]) => Promise<{ bytesRead: number }> }>;
    __setDbBackupFsOpsForTest({
      open: (async (...args: unknown[]) => {
        const handle = await realOpen(...args);
        const realRead = handle.read.bind(handle);
        handle.read = async (...readArgs: unknown[]) => {
          reads.push(readArgs);
          return (realRead as (...a: unknown[]) => Promise<{ bytesRead: number }>)(
            ...readArgs,
          );
        };
        return handle;
      }) as unknown as typeof openFileHandle,
    });
    try {
      // 魔数不匹配 ⇒ 校验步抛错，导入不会开始（不破坏后续用例的库文件）。
      await assert.rejects(
        () => importDatabaseBackupFromPath(notSqlite),
        /不是有效的 SQLite 数据库备份/,
      );
    } finally {
      __setDbBackupFsOpsForTest(null);
    }

    assert.equal(reads.length, 1, "校验步应当只做一次 read");
    const [, offset, length, position] = reads[0]!;
    assert.equal(offset, 0);
    assert.equal(length, 16);
    assert.equal(position, 0);
  });
});
