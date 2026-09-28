/**
 * 「收尾维护 pending 兜底标记」的补跑与清除用例（cr-31 NF-1 新建文件）。
 *
 * 【与姊妹文件的分工（两文件注释互相点明）】既有
 * `blob-binary-normalization.test.ts` 负责主循环 / 收尾谓词校验 / 门条件 /
 * 幂等 / 状态查询等覆盖，维护链路判据止于 `maintCalls`（「是否进入维护段」，
 * 含被进程级去重短路的调用，不代表 VACUUM 真跑）；**本文件不重复那些用例**，
 * 只承载「pending 标记的补跑与清除」——判据落点是**标记状态**（kkv_entry
 * 里 `startupMaintenancePending` 的有无）。
 *
 * 为什么必须独立文件：node:test 每个测试文件一个独立进程，本文件的
 * `runStartupMaintenanceOnce` 进程级去重标记（模块私有布尔）在本进程内
 * 未被消费 ⇒ 首次调用**真跑**维护链路并返回非 null ⇒ cr-32 的条件式清
 * 标记分支真的执行 ⇒ 「pending 被清」这条正向路径在这里才可观测（姊妹
 * 文件的第一条用例必然消费掉该标记，恒返回 null，正向路径在那里必然
 * 打红——这正是 cr-31 NF-1 拆文件的缘由）。
 *
 * 【顺序约束（本文件自己的第一条约束）】第一条用例必须是「预置
 * startupMaintenancePending → 跑归一 → maintCalls === 1 且 pending 被清」：
 * 一旦别的用例排到它前面消费了进程级标记，这条正向路径就再也观测不到。
 *
 * @module test/infra/blob-binary-normalization-maintenance
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SqliteKkvRepository } from "../../src/domain/kkv/repositories/impl/sqlite-kkv.repository.js";
import {
  BLOB_BINARY_KKV_MODULE,
  runBlobBinaryNormalization,
  type RunBlobBinaryNormalizationOptions,
} from "../../src/infra/db-maintenance/index.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 谓词命中行清零 + 完成/兜底标记清零（口径同姊妹文件的 reset）。 */
async function resetNormalizationState(): Promise<void> {
  await getNovelMasterTestContext().conn.execute(
    "DELETE FROM kkv_entry WHERE module = ?",
    [BLOB_BINARY_KKV_MODULE]
  );
}

/**
 * 维护段观测计数器（cr-31 NF-1 的观测缝，口径与姊妹文件统一）：
 * `maintCalls` = **进入收尾维护段的次数（含被进程级去重短路的调用）**，
 * 即 `afterMaintenance` 被调的次数，**不代表 VACUUM 真跑**。
 */
function maintenanceCounter(): {
  readonly maintCalls: () => number;
  readonly hooks: Pick<
    RunBlobBinaryNormalizationOptions,
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

describe("收尾维护 pending 兜底标记（blob-binary-normalization-maintenance）", () => {
  /**
   * 【fix-spec K 节第 1 条 r4 · 文档性防护】本文件第一条用例依赖「进程级
   * 去重标记未被消费」——该标记（`startupMaintenanceRan`）是模块私有布尔、
   * 无法在不消费的前提下直接断言，这里能落成真断言的是持久化侧：文件起始
   * 不得残留 `startupMaintenancePending`（残留会伪造「强制补跑」输入）。
   * 它不解决可观测性；「维护段是否被进入」由下方回调缝观测。
   */
  before(async () => {
    assert.equal(
      await new SqliteKkvRepository(getNovelMasterTestContext().conn).get(
        BLOB_BINARY_KKV_MODULE,
        "startupMaintenancePending"
      ),
      null,
      "文件起始不得残留 startupMaintenancePending 兜底标记"
    );
  });

  /**
   * 【本文件第一条用例，顺序约束勿动（见文件头注释）】pending 补跑的正向
   * 路径：预置 `startupMaintenancePending` + 无待归一行 → 入口读到标记、
   * 无视 processedAny 强制走维护段 → `runStartupMaintenanceOnce` 在本进程
   * 首次调用、真跑并返回非 null → cr-32 的条件式清标记分支执行 → 标记
   * 被清掉。反向判据：把「维护成功返回后清标记」那段注释掉，本用例变红
   *（pending 仍在）——这证明「独立进程」确实换来了可观测性，不是白开
   * 一个文件。
   */
  it("第一条：预置 startupMaintenancePending + 无待归一行 → maintCalls===1 且 pending 被清", async () => {
    await resetNormalizationState();
    await new SqliteKkvRepository(getNovelMasterTestContext().conn).set(
      BLOB_BINARY_KKV_MODULE,
      "startupMaintenancePending",
      "1"
    );

    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(
      getNovelMasterTestContext().conn,
      counter.hooks
    );
    // maintCalls === 1：入口读到 pending 强制走维护段（本轮零行改写，
    // processedAny=false——门条件靠 pending 这一支放行）。语义同姊妹文件：
    // 进入收尾维护段的次数（含被去重短路的调用），不代表 VACUUM 真跑；
    // 不过本用例里它确实真跑了（本进程首次）。
    assert.equal(counter.maintCalls(), 1);
    assert.deepEqual(result, {
      done: true,
      normalizedCount: 0,
      failedCount: 0,
      stalled: false,
    });
    assert.equal(
      await new SqliteKkvRepository(getNovelMasterTestContext().conn).get(
        BLOB_BINARY_KKV_MODULE,
        "startupMaintenancePending"
      ),
      null,
      "维护真跑过（返回非 null）⇒ pending 必须被清掉"
    );
  });

  it("稳态：三表标记已置、无 pending → maintCalls===0", async () => {
    await resetNormalizationState();
    const conn = getNovelMasterTestContext().conn;
    const kkv = new SqliteKkvRepository(conn);
    for (const key of [
      "vfsContentDone",
      "fileCacheDone",
      "messageContentDone",
    ]) {
      await kkv.set(BLOB_BINARY_KKV_MODULE, key, new Date().toISOString());
    }

    const counter = maintenanceCounter();
    const result = await runBlobBinaryNormalization(conn, counter.hooks);
    // 稳态零成本：零行改写 + 无 pending ⇒ 门条件不满足、不进维护段
    //（maintCalls 语义见 maintenanceCounter）。本文件跑这条是为了自身也
    // 钉住零成本路径（cr-31：新文件复验稳态，保证可观测性）。
    assert.equal(counter.maintCalls(), 0);
    assert.deepEqual(result, {
      done: true,
      normalizedCount: 0,
      failedCount: 0,
      stalled: false,
    });
  });
});
