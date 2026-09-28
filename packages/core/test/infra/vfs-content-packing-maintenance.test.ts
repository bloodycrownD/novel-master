/**
 * 「收尾维护 pending 兜底标记」的补跑与清除用例（VFS 打包任务侧，照
 * blob-binary-normalization-maintenance.test.ts 先例独立进程承载）。
 *
 * 【与姊妹文件的分工（两文件注释互相点明）】`vfs-content-packing.test.ts`
 * 负责打包主循环 / 阈值分组 / verify / unpack / stalled 等覆盖，维护链路
 * 判据止于 `maintCalls`（「是否进入维护段」，含被进程级去重短路的调用）；
 * **本文件不重复那些用例**，只承载「pending 标记的补跑与清除」——判据
 * 落点是**标记状态**（kkv_entry 里 `nm-vfs-pack` / `startupMaintenancePending`
 * 的有无）。
 *
 * 为什么必须独立文件：node:test 每个测试文件一个独立进程，本文件的
 * `runStartupMaintenanceOnce` 进程级去重标记（模块私有布尔）在本进程内
 * 未被消费 ⇒ 首次调用**真跑**维护链路并返回非 null ⇒ 条件式清标记分支
 * 真的执行 ⇒ 「pending 被清」这条正向路径在这里才可观测（姊妹文件的首条
 * 打包用例必然消费掉该标记，恒返回 null，正向路径在那里必然打红）。
 *
 * 【顺序约束】第一条用例必须是「预置 pending → 跑打包 → maintCalls===1
 * 且 pending 被清」：一旦别的用例排到它前面消费了进程级标记，这条正向
 * 路径就再也观测不到。
 *
 * @module test/infra/vfs-content-packing-maintenance
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SqliteKkvRepository } from "../../src/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import {
  __resetVfsPackStatusSamplingThrottleForTests,
  runVfsContentPacking,
  VFS_PACK_KKV_MODULE,
  type RunVfsContentPackingOptions,
} from "../../src/infra/db-maintenance/impl/vfs-content-packing.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** KKV 清零（nm-vfs-pack 全部 key）。 */
async function resetPackKkv(): Promise<void> {
  __resetVfsPackStatusSamplingThrottleForTests();
  await getNovelMasterTestContext().conn.execute(
    "DELETE FROM kkv_entry WHERE module = ?",
    [VFS_PACK_KKV_MODULE]
  );
}

/**
 * 维护段观测计数器（口径与姊妹文件统一）：`maintCalls` = 进入收尾维护段
 * 的次数（含被进程级去重短路的调用），即 `afterMaintenance` 被调的次数。
 */
function maintenanceCounter(): {
  readonly maintCalls: () => number;
  readonly hooks: Pick<
    RunVfsContentPackingOptions,
    "beforeMaintenance" | "afterMaintenance"
  >;
} {
  let calls = 0;
  return {
    maintCalls: () => calls,
    hooks: {
      afterMaintenance: () => {
        calls += 1;
      },
    },
  };
}

describe("VFS 打包收尾维护 pending 兜底标记（vfs-content-packing-maintenance）", () => {
  /** 文档性防护：文件起始不得残留 pending（残留会伪造「强制补跑」输入）。 */
  before(async () => {
    assert.equal(
      await new SqliteKkvRepository(getNovelMasterTestContext().conn).get(
        VFS_PACK_KKV_MODULE,
        "startupMaintenancePending"
      ),
      null,
      "文件起始不得残留 startupMaintenancePending 兜底标记"
    );
  });

  /**
   * 【本文件第一条用例，顺序约束勿动（见文件头注释）】pending 补跑的正向
   * 路径：预置 `startupMaintenancePending` + 无候选组（本轮零打包，
   * packedGroups=0——门条件靠 pending 这一支放行）→ `runStartupMaintenanceOnce`
   * 在本进程首次调用、真跑并返回非 null → 条件式清标记分支执行 → 标记被清。
   * 反向判据：把「维护成功返回后清标记」那段注释掉，本用例变红（pending
   * 仍在）——这证明「独立进程」确实换来了可观测性。
   */
  it("第一条：预置 startupMaintenancePending + 零候选 → maintCalls===1 且 pending 被清", async () => {
    await resetPackKkv();
    const conn = getNovelMasterTestContext().conn;
    await new SqliteKkvRepository(conn).set(
      VFS_PACK_KKV_MODULE,
      "startupMaintenancePending",
      "1"
    );

    const counter = maintenanceCounter();
    const result = await runVfsContentPacking(conn, counter.hooks);
    assert.equal(counter.maintCalls(), 1, "入口读到 pending ⇒ 强制走维护段");
    assert.deepEqual(result, {
      done: true,
      packedGroups: 0,
      failedGroups: 0,
      stalled: false,
    });
    assert.equal(
      await new SqliteKkvRepository(conn).get(
        VFS_PACK_KKV_MODULE,
        "startupMaintenancePending"
      ),
      null,
      "维护真跑过（返回非 null）⇒ pending 必须被清掉"
    );
  });

  it("稳态：零候选、无 pending → maintCalls===0", async () => {
    await resetPackKkv();
    const conn = getNovelMasterTestContext().conn;
    const counter = maintenanceCounter();
    const result = await runVfsContentPacking(conn, counter.hooks);
    // 稳态零成本：零打包 + 无 pending ⇒ 门条件不满足、不进维护段。
    assert.equal(counter.maintCalls(), 0);
    assert.deepEqual(result, {
      done: true,
      packedGroups: 0,
      failedGroups: 0,
      stalled: false,
    });
  });
});
