/**
 * 迁移状态行取值纯函数四组夹具（ic-fix-spec ic-22 desktop）。
 *
 * 取值逻辑已从 SettingsViews.tsx 抽到同目录纯 ts 模块（不拖 React 组件
 * 树与 electron preload 依赖），此处直接 import 喂夹具断言分支行为：
 * null→'—'；done→已完成（success）；!done→进行中（剩余 N 条）；done 且
 * failedCount>0→已完成（N 条需人工处理）（warning）。
 *
 * vfsPack 行（T-VP22 第四行）两态口径不同（无终态、无 done 字段）：
 * null→'—'；pendingGroups>0→剩余 N 组；收敛且 failedGroups===0→无需处理
 * （success）；收敛且 failedGroups>0→已完成（N 组需人工处理）（warning）。
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

const messageDecompressRow = MIGRATION_ROWS.find(
  (row) => row.kind === "messageDecompress",
)!;
const vfsContentRow = MIGRATION_ROWS.find(
  (row) => row.kind === "vfsContent",
)!;
const vfsPackRow = MIGRATION_ROWS.find((row) => row.kind === "vfsPack")!;

function stats(partial: {
  messageDecompress?: DbStatsResult["messageDecompress"];
  blobBinary?: DbStatsResult["blobBinary"];
  vfsPack?: DbStatsResult["vfsPack"];
}): DbStatsResult {
  return {
    fileBytes: 1024,
    reclaimableBytes: 0,
    blobBinary: partial.blobBinary ?? { tables: [] },
    messageDecompress: partial.messageDecompress ?? null,
    vfsPack: partial.vfsPack ?? null,
  };
}

describe("migrationRowValue 四组夹具（ic-22）", () => {
  it("null / 表行缺席 → '—'（未取到，tone=default）", () => {
    assert.deepEqual(migrationRowValue(null, messageDecompressRow), {
      text: "—",
      tone: "default",
    });
    // blobBinary 空表（采样失败兜底）同口径：该表行缺席 → '—'。
    assert.deepEqual(
      migrationRowValue(stats({ messageDecompress: { done: true, pendingCount: 0 } }), vfsContentRow),
      { text: "—", tone: "default" },
    );
  });

  it("done → 已完成（tone=success）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({ messageDecompress: { done: true, pendingCount: 0 } }),
        messageDecompressRow,
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
        stats({ messageDecompress: { done: false, pendingCount: 5 } }),
        messageDecompressRow,
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

describe("vfsPack 第四行夹具 + MIGRATION_ROWS 顺序（T-VP22）", () => {
  it("MIGRATION_ROWS 顺序：消息正文明文化 → 版本内容 → 文件缓存 → 历史版本打包（第四行殿后）", () => {
    assert.deepEqual(
      MIGRATION_ROWS.map((row) => row.kind),
      ["messageDecompress", "vfsContent", "fileCache", "vfsPack"],
    );
    assert.equal(vfsPackRow.label, "历史版本打包");
  });

  it("null（未取到/采样失败）→ '—'（tone=default）", () => {
    assert.deepEqual(migrationRowValue(null, vfsPackRow), {
      text: "—",
      tone: "default",
    });
    // 夹具默认 vfsPack 为 null（未传）同口径
    assert.deepEqual(
      migrationRowValue(
        stats({ messageDecompress: { done: true, pendingCount: 0 } }),
        vfsPackRow,
      ),
      { text: "—", tone: "default" },
    );
  });

  it("pendingGroups > 0 → 剩余 N 组（tone=default 进行中态）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({
          vfsPack: {
            pendingGroups: 6,
            memberCount: 120,
            streamBytes: 1_600_000,
            failedGroups: 0,
          },
        }),
        vfsPackRow,
      ),
      { text: "剩余 6 组", tone: "default" },
    );
  });

  it("收敛且 failedGroups === 0 → 无需处理（tone=success）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({
          vfsPack: {
            pendingGroups: 0,
            memberCount: 120,
            streamBytes: 1_600_000,
            failedGroups: 0,
          },
        }),
        vfsPackRow,
      ),
      { text: "无需处理", tone: "success" },
    );
  });

  it("收敛且 failedGroups > 0 → 已完成（N 组需人工处理）（tone=warning 第三态）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({
          vfsPack: {
            pendingGroups: 0,
            memberCount: 120,
            streamBytes: 1_600_000,
            failedGroups: 2,
          },
        }),
        vfsPackRow,
      ),
      { text: "已完成（2 组需人工处理）", tone: "warning" },
    );
  });

  it("pendingGroups > 0 时坏组快照不抢进行中态（进度优先显示）", () => {
    assert.deepEqual(
      migrationRowValue(
        stats({
          vfsPack: {
            pendingGroups: 3,
            memberCount: 120,
            streamBytes: 1_600_000,
            failedGroups: 2,
          },
        }),
        vfsPackRow,
      ),
      { text: "剩余 3 组", tone: "default" },
    );
  });
});
