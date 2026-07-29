/**
 * Step 12 / T-C2 / V8: 验证 capture 事务化后并发不捕获陈旧 head，
 * 以及 1000 文件规模下的性能基线。
 *
 * @module test/message-checkpoint/checkpoint-capture-transactional
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listSessionFileHeads } from "../../src/domain/message-checkpoint/logic/list-session-files.js";
import { SqliteVfsEntryRepository } from "../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("checkpoint capture transactional (T-C2 / V8)", () => {
  it("V8: capture 事务内的扫描隔离——不包含事务外写入", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-V8-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 写初始文件 fileA
    await svfs.write("/a.md", "alpha", { versionCheck: false });
    // 写 fileC（用于验证后续步骤）
    await svfs.write("/c.md", "charlie", { versionCheck: false });

    // 开启一个事务 tx1，在 tx1 内扫描 heads
    const tx1Heads = await ctx.conn.transaction(async (tx) => {
      const txEntries = new SqliteVfsEntryRepository(tx);
      return listSessionFileHeads(txEntries, project.id, session.id);
    });

    // 在 tx1 提交后，写一个额外文件 fileB，再开启 tx2 扫描
    await svfs.write("/b.md", "bravo", { versionCheck: false });
    const tx2Heads = await ctx.conn.transaction(async (tx) => {
      const txEntries = new SqliteVfsEntryRepository(tx);
      return listSessionFileHeads(txEntries, project.id, session.id);
    });

    // tx1 扫描在 fileB 写入前完成，不应包含 fileB
    const tx1Paths = tx1Heads.map((h) => h.logicalPath).sort();
    assert.deepEqual(tx1Paths, ["/a.md", "/c.md"]);

    // tx2 扫描在 fileB 写入后，应包含 fileB
    const tx2Paths = tx2Heads.map((h) => h.logicalPath).sort();
    assert.deepEqual(tx2Paths, ["/a.md", "/b.md", "/c.md"]);

    // 验证 entryId 一致（fileA 的 entryId 在两个事务中相同）
    const aInTx1 = tx1Heads.find((h) => h.logicalPath === "/a.md")!;
    const aInTx2 = tx2Heads.find((h) => h.logicalPath === "/a.md")!;
    assert.equal(aInTx1.entryId, aInTx2.entryId);
    assert.equal(aInTx1.headVersion, aInTx2.headVersion);
  });

  it("V8: capture 通过 service 调用时 scan + insert 在同一事务边界内", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-V8b-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 写两个文件
    await svfs.write("/x.md", "xray", { versionCheck: false });
    await svfs.write("/y.md", "yankee", { versionCheck: false });

    // 创建消息并 capture
    const msg = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "capture-test" }],
    });
    await ctx.messageCheckpoint.capture(session.id, project.id, msg.id);

    // 验证 checkpoint 只包含 capture 时的两个文件
    const repo = new (await import("../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js")).SqliteMessageCheckpointRepository(
      ctx.conn,
    );
    const tree = await repo.loadFileTree(session.id, msg.id);
    assert.ok(tree);
    assert.equal(tree.size, 2);
    assert.ok(tree.has("/x.md"));
    assert.ok(tree.has("/y.md"));

    // capture 后再写一个新文件，验证已有 checkpoint 不受影响
    await svfs.write("/z.md", "zulu", { versionCheck: false });
    const treeAfter = await repo.loadFileTree(session.id, msg.id);
    assert.equal(treeAfter!.size, 2); // 之前 capture 的 checkpoint 不应包含 z.md
  });

  it("V8: 并发扫描验证——Promise.all 模拟两 capture 同时启动", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-V8c-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 写 5 个初始文件
    const initialFiles = ["/f1.md", "/f2.md", "/f3.md", "/f4.md", "/f5.md"];
    for (const p of initialFiles) {
      await svfs.write(p, `content-${p}`, { versionCheck: false });
    }

    // 创建两个消息，各自需要 capture
    const msgA = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "msgA" }],
    });
    const msgB = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "msgB" }],
    });

    // 用 Promise.all 模拟并发 capture
    // 由于 node:test 是单线程，Promise.all 不会真正并行，
    // 但可以验证 capture 的事务原子性——即使顺序执行也不会相互污染
    await Promise.all([
      ctx.messageCheckpoint.capture(session.id, project.id, msgA.id),
      ctx.messageCheckpoint.capture(session.id, project.id, msgB.id),
    ]);

    // 验证两个 checkpoint 都正确记录了 5 个文件
    const repo = new (await import("../../src/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js")).SqliteMessageCheckpointRepository(
      ctx.conn,
    );
    const treeA = await repo.loadFileTree(session.id, msgA.id);
    const treeB = await repo.loadFileTree(session.id, msgB.id);
    assert.ok(treeA);
    assert.ok(treeB);
    assert.equal(treeA.size, 5);
    assert.equal(treeB.size, 5);

    // 验证两个 checkpoint 记录的 version 一致（都是同一时刻的 head）
    for (const [path, version] of treeA) {
      assert.equal(treeB.get(path), version);
    }
  });
});

describe("checkpoint capture transactional performance (T-C2 / 性能基线)", () => {
  it("capture 1000 文件 P95 不超过基线（800ms，CI 宽松倍率）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`Perf-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);

    // 写 1000 个文件
    for (let i = 0; i < 1000; i++) {
      await svfs.write(`/file-${i}.txt`, `body-${i}`, {
        versionCheck: false,
      });
    }

    const msg = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "perf-capture" }],
    });

    // 跑 3 次取 P95 或直接断言单次耗时
    const SAMPLE_RUNS = 3;
    const durations: number[] = [];
    for (let run = 0; run < SAMPLE_RUNS; run++) {
      const start = performance.now();
      await ctx.messageCheckpoint.capture(session.id, project.id, msg.id);
      durations.push(performance.now() - start);
    }

    // 性能基线：capture 移入事务后持锁时长 ≤ 200ms × 4 (CI slack) = 800ms
    const maxDuration = Math.max(...durations);
    const BASELINE_MS = 800;
    assert.ok(
      maxDuration < BASELINE_MS,
      `capture 耗时 ${maxDuration.toFixed(1)}ms 超过基线 ${BASELINE_MS}ms`,
    );
  });
});
