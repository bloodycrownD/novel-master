/**
 * entry-sequence repair：孤儿 revision 占号导致新建撞
 * UNIQUE(vfs_revision.entry_id, version) 的复现与修复验证。
 *
 * @module test/vfs/entry-sequence-repair
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSkillsService } from "@novel-master/core/skills";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import { createVfsEntrySequenceRepairOperation } from "../../src/domain/vfs/logic/entry-sequence-repair.js";
import { runIntegrityRepair } from "../../src/service/integrity-repair.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const SKILL_MD = (name: string) =>
  `---\nname: ${name}\ndescription: 修复验证\n---\n\n正文\n`;

/** 造出病灶：删掉部分 entry 行但保留 revision（孤儿占号），并把发号器压回去。 */
async function seedOrphanOccupiedIds(
  ctx: ReturnType<typeof getNovelMasterTestContext>,
): Promise<{ orphanIds: number[] }> {
  const skills = createSkillsService(ctx.conn);
  const names = [
    `orph-a-${testIsolationSuffix()}`,
    `orph-b-${testIsolationSuffix()}`,
  ];
  const ids: number[] = [];
  for (const n of names) {
    await skills.writeSkillFile("global", n, undefined, SKILL_MD(n));
    const row = await ctx.conn.query<{ id: number }>(
      "SELECT entry_id AS id FROM vfs_entry WHERE scope_key = 'global:meta' AND path = ?",
      [`/meta/skills/${n}/SKILL.md`],
    );
    ids.push(Number(row[0]!.id));
  }
  // 模拟历史病灶：entry 行删除（发号器不回退），revision 保留 → 孤儿占号
  for (const n of names) {
    await ctx.conn.execute(
      "DELETE FROM vfs_entry WHERE scope_key = 'global:meta' AND path LIKE ?",
      [`/meta/skills/${n}%`],
    );
  }
  // 再把 sqlite_sequence 压到 entry 表当前 max（模拟迁移重建回退）
  await ctx.conn.execute(
    "UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(entry_id), 0) FROM vfs_entry) " +
      "WHERE name = 'vfs_entry'",
  );
  return { orphanIds: ids };
}

describe("vfs entry-sequence repair", () => {
  it("孤儿占号 + 发号器回退 → 未修复时新建撞 UNIQUE；修复后成功", async () => {
    const ctx = getNovelMasterTestContext();
    const { orphanIds } = await seedOrphanOccupiedIds(ctx);
    const maxOrphan = Math.max(...orphanIds);

    const op = createVfsEntrySequenceRepairOperation(ctx.conn);
    const det = await op.detect();
    assert.equal(det.needsRepair, true, "应检出发号器低于孤儿占号");

    const skills = createSkillsService(ctx.conn);
    const doomed = `doomed-${testIsolationSuffix()}`;
    // 未修复：新 entry 复用孤儿 entry_id → revision (id, v1) 撞唯一键
    await assert.rejects(
      () => skills.writeSkillFile("global", doomed, undefined, SKILL_MD(doomed)),
      (error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        return msg.includes("UNIQUE");
      },
    );
    // 撞剩的半个现场清掉（事务应已回滚，防御性删残留）
    await ctx.conn.execute(
      "DELETE FROM vfs_entry WHERE scope_key = 'global:meta' AND path LIKE ?",
      [`/meta/skills/${doomed}%`],
    );

    await op.repair();
    const after = await op.detect();
    assert.equal(after.needsRepair, false, "修复后不再检出");

    const ok = `healed-${testIsolationSuffix()}`;
    const r = await skills.writeSkillFile("global", ok, undefined, SKILL_MD(ok));
    assert.ok(r.version >= 1);

    // 发号器已越过孤儿最大号
    const [seqRow] = await ctx.conn.query<{ seq: number }>(
      "SELECT seq FROM sqlite_sequence WHERE name = 'vfs_entry'",
    );
    assert.ok(
      Number(seqRow!.seq) >= maxOrphan,
      `seq(${seqRow!.seq}) 应 ≥ 孤儿最大号(${maxOrphan})`,
    );
  });

  it("健康库：detect 为 false，repair 无副作用", async () => {
    const ctx = getNovelMasterTestContext();
    const op = createVfsEntrySequenceRepairOperation(ctx.conn);
    const det = await op.detect();
    assert.equal(det.needsRepair, false);
    await op.repair();
    const after = await op.detect();
    assert.equal(after.needsRepair, false);
  });

  it("T-V4：查询抛错时 detect 异常上抛，registry 保守判需要修复，绝不伪装健康", async () => {
    // mock 连接：所有查询抛错，模拟 op-sqlite 等驱动读边界查询失败
    const brokenConn: TdbcConnection = {
      async execute() {
        throw new Error("mock: execute 不可用");
      },
      async query() {
        throw new Error("mock: sqlite_sequence 读取失败");
      },
      async batch() {
        throw new Error("mock: batch 不可用");
      },
      async transaction() {
        throw new Error("mock: transaction 不可用");
      },
      async close() {},
    };
    const op = createVfsEntrySequenceRepairOperation(brokenConn);

    // detect 不吞错：异常直接上抛，绝不返回「健康」
    await assert.rejects(
      () => op.detect(),
      /mock: sqlite_sequence 读取失败/,
    );

    // 经 registry 编排：detect 抛错被保守地判为需要修复，repair 再试抛错挂报告
    const report = await runIntegrityRepair(op);
    assert.equal(
      report.detection.needsRepair,
      true,
      "detect 抛错应按「需要修复」保守处理",
    );
    assert.equal(report.repaired, false);
    assert.ok(report.error instanceof Error, "repair 阶段错误应挂到报告 error");
  });
});
