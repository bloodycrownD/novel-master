/**
 * 迁移状态行取值纯函数四组夹具（ic-fix-spec ic-22 desktop）。
 *
 * 取值逻辑已从 SettingsViews.tsx 抽到同目录纯 ts 模块（不拖 React 组件
 * 树与 electron preload 依赖），此处直接 import 喂夹具断言分支行为：
 * null→'—'；done→已完成（success）；!done→进行中（剩余 N 条）；done 且
 * failedCount>0→已完成（N 条需人工处理）（warning）。
 *
 * @module test/migration-row-value
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIGRATION_ROWS,
  migrationRowValue,
} from "../renderer/features/settings/migration-row-value.js";
import type { DbStatsResult } from "../shared/ipc-types.js";

const messageCompactionRow = MIGRATION_ROWS.find(
  (row) => row.kind === "messageCompaction",
)!;
const vfsContentRow = MIGRATION_ROWS.find(
  (row) => row.kind === "vfsContent",
)!;

function stats(partial: {
  messageCompaction?: DbStatsResult["messageCompaction"];
  blobBinary?: DbStatsResult["blobBinary"];
}): DbStatsResult {
  return {
    fileBytes: 1024,
    reclaimableBytes: 0,
    blobBinary: partial.blobBinary ?? { tables: [] },
    messageCompaction: partial.messageCompaction ?? null,
  };
}

describe("migrationRowValue 四组夹具（ic-22）", () => {
  it("null / 表行缺席 → '—'（未取到，tone=default）", () => {
    assert.deepEqual(migrationRowValue(null, messageCompactionRow), {
      text: "—",
      tone: "default",
    });
    // blobBinary 空表（采样失败兜底）同口径：该表行缺席 → '—'。
    assert.deepEqual(
      migrationRowValue(stats({ messageCompaction: { done: true, pendingCount: 0 } }), vfsContentRow),
      { text: "—", tone: "default" },
    );
  });

  it("done → 已完成（tone=success）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({ messageCompaction: { done: true, pendingCount: 0 } }),
        messageCompactionRow,
      ),
      { text: "已完成", tone: "success" },
    );
    assert.deepEqual(
      migrationRowValue(
        stats({
          blobBinary: {
            tables: [
              { table: "vfsContent", done: true, pendingCount: 0, failedCount: 0 },
            ],
          },
        }),
        vfsContentRow,
      ),
      { text: "已完成", tone: "success" },
    );
  });

  it("!done → 进行中（剩余 N 条）（tone=default）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({ messageCompaction: { done: false, pendingCount: 5 } }),
        messageCompactionRow,
      ),
      { text: "进行中（剩余 5 条）", tone: "default" },
    );
    assert.deepEqual(
      migrationRowValue(
        stats({
          blobBinary: {
            tables: [
              { table: "vfsContent", done: false, pendingCount: 12, failedCount: 0 },
            ],
          },
        }),
        vfsContentRow,
      ),
      { text: "进行中（剩余 12 条）", tone: "default" },
    );
  });

  it("done 且 failedCount>0 → 已完成（N 条需人工处理）（tone=warning 第三态）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({
          blobBinary: {
            tables: [
              { table: "vfsContent", done: true, pendingCount: 0, failedCount: 3 },
            ],
          },
        }),
        vfsContentRow,
      ),
      { text: "已完成（3 条需人工处理）", tone: "warning" },
    );
  });
});
