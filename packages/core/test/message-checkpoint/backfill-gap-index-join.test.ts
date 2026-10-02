/**
 * CS-09「backfill 倒扫改单查询 JOIN」的验收（fix-spec/wave-c2.md §C2-6 F1/F2/F3）。
 *
 * 观测面：`hasCheckpoint` / `findLastCheckpointedMessageId` 的**直接调用次数**
 * （包一层 repo 代理），以及补写后 `message_checkpoint` 的行集合。
 *
 * 旧实现（从消息尾部逐条 `hasCheckpoint` 倒扫）下，F1 三条路径都是 O(M) ⇒ 必红。
 * ⚠️ F1 的期望**不是**「`hasCheckpoint` 恒 0」：C2-2 的段 2「连续前缀复核」
 * 合法地用 O(gap) 次 `hasCheckpoint` 闭合并发插点的 TOCTOU。
 *
 * @module test/message-checkpoint/backfill-gap-index-join
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createMessageCheckpointService } from "@novel-master/core/message-checkpoint";
import {
  backfillBaselineCheckpoints,
  scanBackfillGap,
  writeBackfillGap,
} from "@/domain/message-checkpoint/logic/backfill-baseline-checkpoints.js";
import { SqliteMessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/impl/sqlite-message-checkpoint.repository.js";
import type { MessageCheckpointRepository } from "@/domain/message-checkpoint/repositories/message-checkpoint.port.js";
import { SqliteMessageRepository } from "@/domain/chat/repositories/impl/sqlite-message.repository.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import type { ChatMessageHeader } from "@/domain/chat/model/message.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  openNovelMasterTestConnection,
  type NovelMasterTestContext,
} from "../helpers/novel-master.js";

interface Counters {
  hasCheckpoint: number;
  findLastCheckpointedMessageId: number;
}

/** 包一层计数代理：只拦两个被验收盯着的读口，其余方法直通。 */
function countingRepo(
  repo: MessageCheckpointRepository,
  counters: Counters
): MessageCheckpointRepository {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop === "hasCheckpoint") {
        return (...args: unknown[]) => {
          counters.hasCheckpoint += 1;
          return (
            target as unknown as { hasCheckpoint: (...a: unknown[]) => Promise<boolean> }
          ).hasCheckpoint(...args);
        };
      }
      if (prop === "findLastCheckpointedMessageId") {
        return (...args: unknown[]) => {
          counters.findLastCheckpointedMessageId += 1;
          return (
            target as unknown as {
              findLastCheckpointedMessageId: (...a: unknown[]) => Promise<string | null>;
            }
          ).findLastCheckpointedMessageId(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** 旧实现的参考形态：从尾部逐条 `hasCheckpoint` 倒扫（仅供 F2 对拍）。 */
async function referenceFirstGapIndex(
  checkpointRepo: MessageCheckpointRepository,
  sessionId: string,
  messages: ReadonlyArray<ChatMessageHeader>
): Promise<number> {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (await checkpointRepo.hasCheckpoint(sessionId, messages[i]!.id)) {
      return i + 1;
    }
  }
  return 0;
}

describe("CS-09 空窗定位：单查询 JOIN 替代倒扫", () => {
  let ctx: NovelMasterTestContext;
  let conn: TdbcConnection;

  before(async () => {
    ctx = await openNovelMasterTestConnection();
    conn = ctx.conn;
  });

  after(async () => {
    await ctx.conn.close();
  });

  async function seed(
    label: string,
    messageCount: number,
    capturedIndexes: readonly number[]
  ): Promise<{ projectId: string; sessionId: string; ids: string[] }> {
    const project = await ctx.projects.create(`P-${label}-${Date.now()}-${Math.random()}`);
    const session = await ctx.sessions.create(project.id);
    const ids: string[] = [];
    for (let i = 0; i < messageCount; i++) {
      ids.push(
        (
          await ctx.messages.append(session.id, i % 2 === 0 ? "user" : "assistant", {
            blocks: [{ type: "text", text: `m${i}` }],
          })
        ).id
      );
    }
    // 造 live 文件：backfill 无 live 文件时直接空操作。
    await ctx.sessionVfs(project.id, session.id).write("/a.md", `a-${label}`, {
      versionCheck: false,
    });
    const checkpoints = createMessageCheckpointService(conn);
    for (const i of capturedIndexes) {
      await checkpoints.capture(session.id, project.id, ids[i]!);
    }
    return { projectId: project.id, sessionId: session.id, ids };
  }

  it("F1: 有 gap / 无 gap / 全 gap 三条路径的 hasCheckpoint 次数 ≤ gap 长度", async () => {
    const entries = new SqliteVfsEntryRepository(conn);
    const messages = new SqliteMessageRepository(conn);

    // ① 有 gap：6 条消息，第 3 条（0-based 2）有 checkpoint ⇒ gap = 3。
    const withGap = await seed("f1-gap", 6, [2]);
    {
      const counters = { hasCheckpoint: 0, findLastCheckpointedMessageId: 0 };
      const repo = countingRepo(
        new SqliteMessageCheckpointRepository(conn),
        counters
      );
      const scan = await scanBackfillGap({
        entryRepo: entries,
        messageRepo: messages,
        checkpointRepo: repo,
        projectId: withGap.projectId,
        sessionId: withGap.sessionId,
      });
      assert.equal(scan.gapMessageIds.length, 3, "gap 应为最后 3 条");
      await writeBackfillGap({
        checkpointRepo: repo,
        sessionId: withGap.sessionId,
        scan,
      });
      assert.equal(counters.findLastCheckpointedMessageId, 1, "定位必须只发一条查询");
      assert.ok(
        counters.hasCheckpoint <= scan.gapMessageIds.length,
        `hasCheckpoint ${counters.hasCheckpoint} 超过 gap 长度`
      );
    }

    // ② 无 gap：最后一条就有 checkpoint。
    const noGap = await seed("f1-nogap", 4, [3]);
    {
      const counters = { hasCheckpoint: 0, findLastCheckpointedMessageId: 0 };
      const repo = countingRepo(
        new SqliteMessageCheckpointRepository(conn),
        counters
      );
      const scan = await scanBackfillGap({
        entryRepo: entries,
        messageRepo: messages,
        checkpointRepo: repo,
        projectId: noGap.projectId,
        sessionId: noGap.sessionId,
      });
      assert.deepEqual(scan.gapMessageIds, []);
      assert.equal(scan.confirmedNoGap, true);
      await writeBackfillGap({
        checkpointRepo: repo,
        sessionId: noGap.sessionId,
        scan,
      });
      assert.equal(counters.hasCheckpoint, 0, "空 gap 一次复核都不该发");
    }

    // ③ 全 gap：一条 checkpoint 都没有。
    const allGap = await seed("f1-allgap", 5, []);
    {
      const counters = { hasCheckpoint: 0, findLastCheckpointedMessageId: 0 };
      const repo = countingRepo(
        new SqliteMessageCheckpointRepository(conn),
        counters
      );
      const scan = await scanBackfillGap({
        entryRepo: entries,
        messageRepo: messages,
        checkpointRepo: repo,
        projectId: allGap.projectId,
        sessionId: allGap.sessionId,
      });
      assert.equal(scan.gapMessageIds.length, allGap.ids.length);
      await writeBackfillGap({
        checkpointRepo: repo,
        sessionId: allGap.sessionId,
        scan,
      });
      assert.equal(counters.hasCheckpoint, 1, "全 gap 只需复核到第一条就停");
    }
  });

  it("F1: hasCheckpoint 次数与消息总数 M 无关（gap 同为 3，M=6 vs M=106）", async () => {
    const entries = new SqliteVfsEntryRepository(conn);
    const messages = new SqliteMessageRepository(conn);

    const run = async (
      label: string,
      messageCount: number,
      anchorIndex: number
    ): Promise<number> => {
      const seeded = await seed(label, messageCount, [anchorIndex]);
      const counters = { hasCheckpoint: 0, findLastCheckpointedMessageId: 0 };
      const repo = countingRepo(
        new SqliteMessageCheckpointRepository(conn),
        counters
      );
      const scan = await scanBackfillGap({
        entryRepo: entries,
        messageRepo: messages,
        checkpointRepo: repo,
        projectId: seeded.projectId,
        sessionId: seeded.sessionId,
      });
      assert.equal(scan.gapMessageIds.length, 3, "两条会话的 gap 必须都是 3");
      await writeBackfillGap({
        checkpointRepo: repo,
        sessionId: seeded.sessionId,
        scan,
      });
      return counters.hasCheckpoint;
    };

    // 主差分断言：M 差 17 倍，hasCheckpoint 次数必须一致。
    // 旧实现下这里是 M 次单行读（尾部倒扫到锚点）⇒ 必红。
    const small = await run("f1-m6", 6, 2);
    const big = await run("f1-m106", 106, 102);
    assert.equal(big, small, `M=6 时 ${small} 次，M=106 时 ${big} 次`);
  });

  it("F2: 与 hasCheckpoint 倒扫参考实现逐条对拍（新增行集合相等）", async () => {
    const entries = new SqliteVfsEntryRepository(conn);
    const messages = new SqliteMessageRepository(conn);

    // 夹具刻意做成「中间的某条也有 checkpoint」——倒扫遇点即停，
    // 起点必须落在**最后**那个点之后。
    const seeded = await seed("f2", 8, [1, 4]);

    const headers = await messages.listMessageHeadersBySession(seeded.sessionId);
    const plain = new SqliteMessageCheckpointRepository(conn);
    const expectedGapIndex = await referenceFirstGapIndex(
      plain,
      seeded.sessionId,
      headers
    );
    const expectedIds = headers
      .slice(expectedGapIndex)
      .map((m) => m.id)
      .sort();

    const before = await checkpointIds(conn, seeded.sessionId);
    await backfillBaselineCheckpoints(
      entries,
      messages,
      plain,
      seeded.projectId,
      seeded.sessionId
    );
    const after = await checkpointIds(conn, seeded.sessionId);

    const added = after.filter((id) => !before.includes(id)).sort();
    assert.deepEqual(added, expectedIds, "新增 checkpoint 行集合必须与倒扫参考实现一致");
  });

  it("F3: 空会话 / 无 gap 会话 —— firstGapIndex 分别为 0 与 messages.length", async () => {
    const entries = new SqliteVfsEntryRepository(conn);
    const messages = new SqliteMessageRepository(conn);

    // ① 一条 checkpoint 都没有 ⇒ firstGapIndex = 0（整表都是空窗）。
    const none = await seed("f3-none", 4, []);
    {
      const scan = await scanBackfillGap({
        entryRepo: entries,
        messageRepo: messages,
        checkpointRepo: new SqliteMessageCheckpointRepository(conn),
        projectId: none.projectId,
        sessionId: none.sessionId,
      });
      assert.equal(scan.gapMessageIds.length, none.ids.length);
      assert.equal(scan.gapMessageIds[0], none.ids[0]);
    }

    // ② 最后一条就是 checkpoint ⇒ firstGapIndex = messages.length，不新增行。
    const tail = await seed("f3-tail", 4, [3]);
    {
      const before = await checkpointIds(conn, tail.sessionId);
      const scan = await scanBackfillGap({
        entryRepo: entries,
        messageRepo: messages,
        checkpointRepo: new SqliteMessageCheckpointRepository(conn),
        projectId: tail.projectId,
        sessionId: tail.sessionId,
      });
      assert.deepEqual(scan.gapMessageIds, [], "无空窗 ⇒ 不补任何消息");
      assert.equal(scan.confirmedNoGap, true);
      await writeBackfillGap({
        checkpointRepo: new SqliteMessageCheckpointRepository(conn),
        sessionId: tail.sessionId,
        scan,
      });
      assert.deepEqual(await checkpointIds(conn, tail.sessionId), before);
    }

    // ③ 空消息会话（有 live 文件）⇒ 恒无空窗，不新增行。
    const emptyProject = await ctx.projects.create(`P-f3-empty-${Date.now()}`);
    const emptySession = await ctx.sessions.create(emptyProject.id);
    await ctx.sessionVfs(emptyProject.id, emptySession.id).write("/only.md", "x", {
      versionCheck: false,
    });
    const scan = await scanBackfillGap({
      entryRepo: entries,
      messageRepo: messages,
      checkpointRepo: new SqliteMessageCheckpointRepository(conn),
      projectId: emptyProject.id,
      sessionId: emptySession.id,
    });
    assert.deepEqual(scan.gapMessageIds, []);
    assert.equal(scan.confirmedNoGap, true);
  });
});

async function checkpointIds(
  conn: TdbcConnection,
  sessionId: string
): Promise<string[]> {
  const rows = await conn.query<{ message_id: string }>(
    `SELECT message_id FROM message_checkpoint WHERE session_id = ?`,
    [sessionId]
  );
  return rows.map((r) => String(r.message_id));
}