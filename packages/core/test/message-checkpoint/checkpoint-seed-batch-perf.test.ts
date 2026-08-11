/**
 * checkpoint seed 批量化的性能验证（200 文件 × 500 消息）。
 *
 * 根因：seedForkCopyParity 对每条消息调 insertCheckpoint，原实现里
 *   - 每个文件指针逐条 INSERT message_checkpoint_file
 *   - 每个文件指针逐条 UPDATE vfs_revision.ref_count
 * 200 文件 × 500 消息 = 20 万次 SQL 往返，约 1.8s。
 *
 * 批量化后：insertCheckpoint 内 files 用 conn.batch 一次插入；
 * increment/decrement 走 batchAdjustRefCount（按 500 分块 UPDATE）。
 * 这里直接对 insertCheckpoint 压测，确认从 ~1.8s 降到合理范围。
 *
 * 注意：这是性能 smoke 测试，阈值给得宽松（上限 800ms），目的是捕捉
 * 「批量退化回逐条」的回归，不是做精确 benchmark。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { performance } from "node:perf_hooks";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import { scopeKey } from "@/domain/vfs/logic/vfs-path-mapper.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const FILE_COUNT = 200;
const MESSAGE_COUNT = 500;
/**
 * 性能上限：批量实现应远低于此；退化到逐条会超时失败。
 *
 * 注意：这里给得比较宽松（1500ms），因为在测试套件里并发跑时会有 CPU 竞争导致
 * 抖动。原来的逐条实现在这个规模（200×500）下要 ~1.8s，所以 1500ms 仍然能
 * 捕捉到「批量退化回逐条」的回归。单独跑通常在 600-700ms。
 */
const INSERT_CHECKPOINT_BUDGET_MS = 1500;

describe("checkpoint seed 批量化性能（200 文件 × 500 消息）", () => {
  it("T-PERF-BATCH：500 条消息各 insertCheckpoint（200 文件指针）应在预算内完成", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    const entries = new SqliteVfsEntryRepository(ctx.conn);
    const sk = scopeKey({
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });

    // 准备 200 个文件，收集 (entryId, version) 指针
    const pointers: Array<{ entryId: number; revisionVersion: number }> = [];
    for (let i = 0; i < FILE_COUNT; i++) {
      const p = `/perf-${i}.md`;
      await svfs.write(p, `body-${i}`, { versionCheck: false });
      const entry = await entries.findByPath(sk, p);
      const version = (await svfs.read(p)).version;
      pointers.push({ entryId: entry!.entryId, revisionVersion: version });
    }

    const checkpoints = new SqliteMessageCheckpointRepository(ctx.conn);

    // 500 条消息，每条都 insertCheckpoint（带全部 200 文件指针）
    // 这模拟 seedForkCopyParity 的最坏路径
    const start = performance.now();
    for (let m = 0; m < MESSAGE_COUNT; m++) {
      await checkpoints.insertCheckpoint({
        sessionId: session.id,
        messageId: `msg-perf-${m}`,
        createdAtMs: m,
        files: pointers,
      });
    }
    const elapsed = performance.now() - start;

    // 校验数据正确性：最后一条消息的 checkpoint 应有 200 个文件指针
    const lastTree = await checkpoints.loadFileTree(session.id, `msg-perf-${MESSAGE_COUNT - 1}`);
    assert.ok(lastTree, "末条消息须有 checkpoint");
    assert.equal(lastTree.size, FILE_COUNT, "末条 checkpoint 须包含全部 200 文件");

    // 性能断言：批量实现应远低于预算；逐条实现会跑到 ~1.8s+ 超出预算
    assert.ok(
      elapsed < INSERT_CHECKPOINT_BUDGET_MS,
      `insertCheckpoint × ${MESSAGE_COUNT}（各 ${FILE_COUNT} 文件）耗时 ${elapsed.toFixed(1)}ms 超出预算 ${INSERT_CHECKPOINT_BUDGET_MS}ms，疑似退化为逐条`,
    );
  });
});
