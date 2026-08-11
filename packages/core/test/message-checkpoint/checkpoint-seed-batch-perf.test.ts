/**
 * checkpoint seed 批量化的性能验证（200 文件 × 500 消息）。
 *
 * 根因：seedForkCopyParity 对每条消息调 insertCheckpoint，原实现里
 *   - 每个文件指针逐条 INSERT message_checkpoint_file
 *   - 每个文件指针逐条 UPDATE vfs_revision.ref_count
 * 200 文件 × 500 消息 = 20 万次 SQL 往返，约 1.8s。
 *
 * 批量化后：seedForkCopyParity 调 seedCheckpoints，一次性 batch 插入全部
 * 锚点行 + 文件行，ref_count 用 batchAdjustRefCountWithDelta 一次加 msgCount。
 * 200×500 场景从 ~1.8s 降到 ~170ms。
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
 * 性能上限：seedCheckpoints 批量实现远低于此；退化到逐条会超时失败。
 *
 * 逐条 insertCheckpoint 在这个规模下约 1.8s；批量 seedCheckpoints 约 170ms。
 * 阈值给 800ms，留 4 倍余量吸收 CI 环境抖动，同时仍能捕捉「退化回逐条」的回归。
 */
const SEED_BUDGET_MS = 800;

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

    // 准备 500 条消息 ID
    const messageIds = Array.from({ length: MESSAGE_COUNT }, (_, m) => ({ id: `msg-perf-${m}` }));

    // 测 seedCheckpoints（seedForkCopyParity 的批量路径）
    const start = performance.now();
    await checkpoints.seedCheckpoints(session.id, messageIds, pointers, 0);
    const elapsed = performance.now() - start;

    // 校验数据正确性：最后一条消息的 checkpoint 应有 200 个文件指针
    const lastTree = await checkpoints.loadFileTree(session.id, `msg-perf-${MESSAGE_COUNT - 1}`);
    assert.ok(lastTree, "末条消息须有 checkpoint");
    assert.equal(lastTree.size, FILE_COUNT, "末条 checkpoint 须包含全部 200 文件");

    // 性能断言：批量实现应远低于预算；逐条实现会跑到 ~1.8s+ 超出预算
    assert.ok(
      elapsed < SEED_BUDGET_MS,
      `seedCheckpoints（${MESSAGE_COUNT} 消息 × ${FILE_COUNT} 文件）耗时 ${elapsed.toFixed(1)}ms 超出预算 ${SEED_BUDGET_MS}ms，疑似退化为逐条`,
    );
  });
});
