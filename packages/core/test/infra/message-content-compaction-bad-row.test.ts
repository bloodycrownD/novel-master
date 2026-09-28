/**
 * 坏行隔离用例（ic-07 ④）——独立成文件的原因：要用 `mock.module` 把
 * `encodeMessageContent` 替换成「特定输入抛错」的桩（照
 * agent-runner-compaction.test.ts 的范式），必须在 import 被测模块之前
 * 执行 mock 注册（静态 import 会被提升到 mock 之前，拿到的就不是桩）。
 *
 * 编码失败无法靠数据注入（`encodeMessageContent` 对任意字符串都能压缩），
 * 只能 mock 编码入口按内容标记定向抛错、其余输入透传真实实现——被测的
 * 仍是生产代码的逐行 try/catch 坏行隔离路径本身。
 *
 * @module test/infra/message-content-compaction-bad-row
 */

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { MessageContent } from "../../src/domain/chat/model/message.js";

/** 坏行标记：content_json 含该子串的行编码必抛。 */
const BAD_MARKER = "【模拟坏行：编码必失败】";

// 1) 先拿真实 codec 引用（mock 注册之前的模块缓存，供其余输入透传）。
const realCodec = await import(
  "../../src/domain/chat/logic/message-content-codec.js"
);

// 2) 注册 mock：坏标记输入抛错，其余透传真实实现；decode 必须**补齐全
//    部命名导出**（namedExports 缺的导出会是 undefined，repo 读路径要用）。
mock.module("../../src/domain/chat/logic/message-content-codec.js", {
  namedExports: {
    encodeMessageContent: (json: string) => {
      if (json.includes(BAD_MARKER)) {
        throw new Error(`模拟坏行编码失败：${BAD_MARKER}`);
      }
      return realCodec.encodeMessageContent(json);
    },
    decodeMessageContent: realCodec.decodeMessageContent,
  },
});

// 3) mock 之后再动态 import 被测模块与夹具（顺序不可换）。
const {
  MESSAGE_COMPACTION_KKV_KEY,
  MESSAGE_COMPACTION_KKV_MODULE,
  runMessageContentCompaction,
} = await import("../../src/infra/db-maintenance/index.js");
const {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} = await import("../helpers/novel-master-fixture.js");
const { SqliteMessageRepository } = await import(
  "../../src/domain/chat/repositories/impl/sqlite-message.repository.js"
);
const { SqliteKkvRepository } = await import(
  "../../src/domain/kkv/repositories/impl/sqlite-kkv.repository.js"
);
const { randomUUID } = await import("node:crypto");

novelMasterTestFixture();

describe("坏行隔离（ic-07 ④，mock.module 注入编码失败）", () => {
  it("某行编码抛错 → 其余行全部搬完、failedCount=1、标记已置、坏行明文双形态自愈", async () => {
    // 清完成标记（含 pending 兜底标记，口径同主测试文件）。
    const ctx = getNovelMasterTestContext();
    await ctx.conn.execute(
      "DELETE FROM kkv_entry WHERE module = ?",
      [MESSAGE_COMPACTION_KKV_MODULE]
    );

    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(
      project.id,
      `S-${testIsolationSuffix()}`
    );

    // 5 行明文：第 3 行带坏标记（编码必抛），其余 4 行正常。
    const originals: MessageContent[] = [];
    for (let i = 1; i <= 5; i++) {
      const bad = i === 3;
      const content: MessageContent = {
        blocks: [
          {
            type: "text",
            text: bad
              ? `${BAD_MARKER} 坏行正文 ${i}`
              : `第 ${i} 条正常正文：${"长中文测试。".repeat(20)}`,
          },
        ],
      };
      await ctx.conn.execute(
        `INSERT INTO chat_message (
           id, session_id, seq, role, content_json, created_at_ms, hidden
         ) VALUES (?, ?, ?, 'user', ?, ?, 0)`,
        [
          randomUUID(),
          session.id,
          i,
          JSON.stringify(content),
          Date.now() + i,
        ]
      );
      originals.push(content);
    }

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    };
    let result: Awaited<ReturnType<typeof runMessageContentCompaction>>;
    try {
      result = await runMessageContentCompaction(ctx.conn);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(result.done, true, "坏行不阻断收敛（标记照置）");
    assert.equal(result.compactedCount, 4, "其余 4 行全部搬完");
    assert.equal(result.failedCount, 1, "坏行计入 failedCount");
    assert.equal(result.stalled, false);
    assert.ok(
      warnings.some((line) => line.includes("编码失败")),
      "坏行应逐行 warn 隔离"
    );

    // 完成标记已置，值是 JSON 且 failedCount 快照为 1（ic-07 ④ 的标记
    // 值升级；读取端解析兜底在主测试文件外的实现侧覆盖）。
    const entry = await new SqliteKkvRepository(ctx.conn).get(
      MESSAGE_COMPACTION_KKV_MODULE,
      MESSAGE_COMPACTION_KKV_KEY
    );
    assert.ok(entry != null, "完成标记应已置");
    const parsed = JSON.parse(entry!.value) as { failedCount: number };
    assert.equal(parsed.failedCount, 1, "标记 JSON 里的 failedCount 快照");

    // 坏行明文保留在库里（原样、不写库）。
    const badRows = await ctx.conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chat_message
       WHERE content_json LIKE ? AND content_encoding IS NULL`,
      [`%${BAD_MARKER}%`]
    );
    assert.equal(Number(badRows[0]!.n), 1, "坏行明文原样保留");

    // 双形态自愈：repo 读路径对压缩行（4 行）与明文坏行（1 行）都能读
    // 回等价内容——坏行按明文形态照常可读。
    const repo = new SqliteMessageRepository(ctx.conn);
    const list = await repo.listBySession(session.id);
    assert.equal(list.length, 5, "一条不少");
    for (const msg of list) {
      assert.deepEqual(
        msg.content,
        originals[msg.seq - 1]!,
        `seq=${msg.seq} 读回等价（坏行走明文双形态自愈）`
      );
    }
  });
});
