/**
 * 引用化回迁任务（message-ref-unref）用例：T-UM1 round-trip / T-UM2
 * ref_count 精确对账 / T-UM3 同事务性 / T-UM4 假阳性收敛 / T-UM5 断点续跑
 * 与标记自愈、探针排除 / T-UM6 坏行三判别 + hash 不匹配 / T-UM7 压缩行交叠。
 *
 * 谓词是**全库**的，用例自清（`dropAllRefRows`，行数不依赖执行顺序）。
 *
 * **夹具口径**：存量引用行**不经生产写路径**（v1.5.30 写侧已恒产全文、
 * 仓库里再没有能造出 contentRef 的 API）——用裸 `INSERT INTO chat_message`
 * 直接造 v1.5.29 形态（`content` 为占位空串 + `contentRef` 字段）。源
 * revision 走真写路径（`sessionVfs.write`）以保证 blob 行与触发器自洽。
 *
 * **解压标记前置**：收尾的否决条件只有一个——解压兄弟任务的 KKV 标记
 * （D19）。故除 T-UM7 外，每条需要置标记的用例都先置解压标记
 * （`markDecompressDone`），否则会被 deferred 挡下（那正是 T-UM7 的观测面）。
 *
 * @module test/infra/message-ref-unref
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  MESSAGE_DECOMPRESS_KKV_KEY,
  MESSAGE_DECOMPRESS_KKV_MODULE,
  MESSAGE_REF_UNREF_KKV_KEY,
  MESSAGE_REF_UNREF_KKV_MODULE,
  getMessageRefUnrefStatus,
  runMessageRefUnref,
} from "../../src/infra/db-maintenance/index.js";
import { __resetMessageRefUnrefForTests } from "../../src/infra/db-maintenance/impl/message-ref-unref.js";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import {
  clearDecodedContentCaches,
} from "../../src/infra/content-cache/logic/decoded-content-cache.js";
import { compressZlib } from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import { decodeMessageContent } from "../../src/domain/chat/logic/message-content-codec.js";
import { hashContent } from "../../src/domain/vfs/content-store/logic/hash-content.js";
import type {
  ContentBlock,
  MessageContent,
  ReadResultRef,
  SkillResultRef,
} from "../../src/domain/chat/model/content-block.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function conn(): TdbcConnection {
  return getNovelMasterTestContext().conn;
}

/** 每条用例清本任务 + 解压兄弟任务两侧标记。 */
async function clearMarkers(): Promise<void> {
  await conn().execute(
    "DELETE FROM kkv_entry WHERE module IN (?, ?)",
    [MESSAGE_REF_UNREF_KKV_MODULE, MESSAGE_DECOMPRESS_KKV_MODULE]
  );
  __resetMessageRefUnrefForTests();
}

/** 置解压兄弟任务完成标记（收尾否决的唯一判据，见 D19）。 */
async function markDecompressDone(): Promise<void> {
  await conn().execute(
    "INSERT INTO kkv_entry (module, key, value) VALUES (?, ?, ?) ON CONFLICT(module, key) DO UPDATE SET value = excluded.value",
    [MESSAGE_DECOMPRESS_KKV_MODULE, MESSAGE_DECOMPRESS_KKV_KEY, JSON.stringify({ at: "t", failedCount: 0, failedIds: [] })]
  );
}

/** 谓词行数（与实现同条件）。 */
async function pendingCount(): Promise<number> {
  const rows = await conn().query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM chat_message
     WHERE content_json LIKE '%"contentRef"%' AND content_blob IS NULL`
  );
  return Number(rows[0]?.n ?? 0);
}

async function dropAllRefRows(): Promise<void> {
  await conn().execute(
    `DELETE FROM chat_message WHERE content_json LIKE '%"contentRef"%'`
  );
}

/** 本任务完成标记的原始值（未解析）。 */
async function doneMarkerValue(): Promise<string | null> {
  const rows = await conn().query<{ value: string }>(
    "SELECT value FROM kkv_entry WHERE module = ? AND key = ?",
    [MESSAGE_REF_UNREF_KKV_MODULE, MESSAGE_REF_UNREF_KKV_KEY]
  );
  return rows.length === 0 ? null : String(rows[0]!.value);
}

/** 读一行消息的 content_json 原文。 */
async function contentJsonOf(id: string): Promise<string> {
  const rows = await conn().query<{ content_json: string }>(
    "SELECT content_json FROM chat_message WHERE id = ?",
    [id]
  );
  assert.equal(rows.length, 1, `消息行应存在：${id}`);
  return String(rows[0]!.content_json);
}

/** 新建会话（返回 projectId / sessionId）。 */
async function newSession(tag: string): Promise<{
  projectId: string;
  sessionId: string;
}> {
  const suffix = testIsolationSuffix();
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${tag}-${suffix}`);
  const session = await ctx.sessions.create(project.id, `S-${tag}-${suffix}`);
  return { projectId: project.id, sessionId: session.id };
}

/** 造一个带明文的 revision（真写路径，blob 行与触发器自洽）。 */
async function seedRevision(
  projectId: string,
  sessionId: string,
  plain: string
): Promise<{ entryId: number; version: number; contentHash: string; path: string }> {
  const ctx = getNovelMasterTestContext();
  const path = `/unref-${testIsolationSuffix()}.txt`;
  const { version } = await ctx
    .sessionVfs(projectId, sessionId)
    .write(path, plain);
  const rows = await ctx.conn.query<{ entry_id: number; content_hash: string }>(
    "SELECT entry_id, content_hash FROM vfs_entry WHERE path = ?",
    [path]
  );
  assert.equal(rows.length, 1, "vfs_entry 行应存在");
  return {
    entryId: Number(rows[0]!.entry_id),
    version,
    contentHash: String(rows[0]!.content_hash),
    path,
  };
}

/** ref_count 点查。 */
async function refCountOf(entryId: number, version: number): Promise<number | null> {
  const rows = await conn().query<{ ref_count: number }>(
    "SELECT ref_count FROM vfs_revision WHERE entry_id = ? AND version = ?",
    [entryId, version]
  );
  return rows.length === 0 ? null : Number(rows[0]!.ref_count);
}

/** 读引用块（v1.5.29 read 形态：无 `kind` 键）。 */
function readRef(args: {
  path: string;
  entryId: number;
  version: number;
  contentHash: string;
}): ReadResultRef {
  return {
    path: args.path,
    entryId: args.entryId,
    version: args.version,
    contentHash: args.contentHash,
    totalBytes: 12,
    offset: 1,
    returnedLines: 2,
    totalLines: 2,
    truncated: false,
  };
}

/** skill 引用块（v1.5.29 skill 形态：带 `kind`）。 */
function skillRef(args: {
  path: string;
  entryId: number;
  version: number;
  contentHash: string;
}): SkillResultRef {
  return {
    kind: "skill",
    action: "read",
    domain: "global",
    name: "writer",
    path: args.path,
    entryId: args.entryId,
    version: args.version,
    contentHash: args.contentHash,
    totalBytes: 12,
    offset: 1,
    returnedLines: 2,
    totalLines: 2,
    truncated: false,
    files: ["/skills/writer/extra.md"],
  };
}

/** 裸 INSERT 造一条存量引用行（不经生产写路径）。 */
async function insertRefRow(args: {
  sessionId: string;
  blocks: readonly ContentBlock[];
  /** 覆盖 content_json 原文（默认由 blocks 序列化）——用于造非法 JSON。 */
  rawJson?: string;
  /** 造压缩形态（content_blob 非空 + content_json 空串）。 */
  blobPlain?: string;
}): Promise<string> {
  const id = randomUUID();
  const json =
    args.rawJson ?? JSON.stringify({ blocks: args.blocks } satisfies MessageContent);
  if (args.blobPlain != null) {
    const blob = compressZlib(new TextEncoder().encode(args.blobPlain));
    await conn().execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, content_encoding, content_blob,
         created_at_ms, hidden
       ) VALUES (?, ?, ?, 'user', '', 'zlib', ?, ?, 0)`,
      [id, args.sessionId, Math.floor(Math.random() * 100000), blob, Date.now()]
    );
    return id;
  }
  await conn().execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, created_at_ms, hidden
     ) VALUES (?, ?, ?, 'assistant', ?, ?, 0)`,
    [id, args.sessionId, Math.floor(Math.random() * 100000), json, Date.now()]
  );
  return id;
}

/** 把某行 ref_count 调整到指定值（模拟 +1 叠加 live head）。 */
async function setRefCount(
  entryId: number,
  version: number,
  value: number
): Promise<void> {
  await conn().execute(
    "UPDATE vfs_revision SET ref_count = ? WHERE entry_id = ? AND version = ?",
    [value, entryId, version]
  );
}

/** 抽出正文里 tool_result 块的 content（字符串原样）。 */
function toolResultContents(json: string): string[] {
  const parsed = JSON.parse(json) as MessageContent;
  return parsed.blocks
    .filter((b) => b.type === "tool_result")
    .map((b) => (b as { content: string }).content);
}

describe("message-ref-unref: T-UM1 round-trip", () => {
  it("回填 {path, content} 明文包并移除 contentRef；谓词归零 + 完成标记置位", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um1");
    const plain = "回迁后的明文第一行\n第二行";
    const rev = await seedRevision(projectId, sessionId, plain);
    await setRefCount(rev.entryId, rev.version, 2);

    const id = await insertRefRow({
      sessionId,
      blocks: [
        { type: "text", text: "正文" },
        {
          type: "tool_result",
          toolUseId: "tu-1",
          content: "",
          summary: "读文件",
          contentRef: readRef({
            path: rev.path,
            entryId: rev.entryId,
            version: rev.version,
            contentHash: rev.contentHash,
          }),
        },
      ],
    });

    const before = await refCountOf(rev.entryId, rev.version);
    assert.equal(before, 2, "夹具前置：live head 1 + read 1 = 2");

    const result = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(result.done, true, "空谓词 + 解压标记已置 → 本轮收敛");
    assert.equal(result.unrefedCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(result.noRefBlockCount, 0);
    assert.equal(result.deferred, false);
    assert.equal(result.stalled, false);

    // 回填 JSON 全等 + contentRef 字段消失。
    assert.deepEqual(JSON.parse(await contentJsonOf(id)), {
      blocks: [
        { type: "text", text: "正文" },
        {
          type: "tool_result",
          toolUseId: "tu-1",
          content: JSON.stringify({ path: rev.path, content: plain }),
          summary: "读文件",
        },
      ],
    });
    assert.equal(
      (await contentJsonOf(id)).includes("contentRef"),
      false,
      "回填后正文里不得再有 contentRef 键"
    );
    assert.equal(await pendingCount(), 0, "谓词必须归零");
    assert.notEqual(await doneMarkerValue(), null, "完成标记必须置位");
    const status = await getMessageRefUnrefStatus(conn());
    assert.equal(status.done, true);
    assert.equal(status.pendingCount, 0);

    // 幂等：再跑一轮零成本短路（标记命中 + 探针无命中）。
    const again = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(again.done, true);
    assert.equal(again.unrefedCount, 0, "已完成态不得重复回迁");
    assert.equal(
      await refCountOf(rev.entryId, rev.version),
      1,
      "重复跑不得二次 −1"
    );
  });
});

describe("message-ref-unref: T-UM2 ref_count 精确对账", () => {
  it("每个 pair 恰 −1；同消息两块同 pair 不多减；跨消息累加；悬空 pair no-op", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um2");
    const revA = await seedRevision(projectId, sessionId, "A 的明文");
    const revB = await seedRevision(projectId, sessionId, "B 的明文");
    // A：live head 1 + msg1 两块 + msg2 一块 = 4；B：live head 1 + msg1 一块 = 2
    await setRefCount(revA.entryId, revA.version, 4);
    await setRefCount(revB.entryId, revB.version, 2);

    await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-a1",
          content: "",
          contentRef: readRef({
            path: revA.path,
            entryId: revA.entryId,
            version: revA.version,
            contentHash: revA.contentHash,
          }),
        },
        {
          type: "tool_result",
          toolUseId: "tu-a2",
          content: "",
          contentRef: readRef({
            path: revA.path,
            entryId: revA.entryId,
            version: revA.version,
            contentHash: revA.contentHash,
          }),
        },
        {
          type: "tool_result",
          toolUseId: "tu-b1",
          content: "",
          contentRef: skillRef({
            path: revB.path,
            entryId: revB.entryId,
            version: revB.version,
            contentHash: revB.contentHash,
          }),
        },
      ],
    });
    await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-a3",
          content: "",
          contentRef: readRef({
            path: revA.path,
            entryId: revA.entryId,
            version: revA.version,
            contentHash: revA.contentHash,
          }),
        },
      ],
    });

    const result = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(result.done, true);
    assert.equal(result.unrefedCount, 2);
    // A：两条持有消息各 −1（消息内两块同 pair 只算一次）→ 4 − 2 = 2
    assert.equal(
      await refCountOf(revA.entryId, revA.version),
      2,
      "aggregateReadRefs 口径：消息内去重、消息间累加"
    );
    // B：一条消息 −1 → 2 − 1 = 1
    assert.equal(
      await refCountOf(revB.entryId, revB.version),
      1,
      "skill 引用同样走 −1"
    );

    // 悬空 pair：引用不存在的 entry/version → no-op，不抛不污染计数。
    await dropAllRefRows();
    const danglingId = randomUUID();
    await conn().execute(
      `INSERT INTO chat_message (id, session_id, seq, role, content_json, created_at_ms, hidden)
       VALUES (?, ?, ?, 'assistant', ?, ?, 0)`,
      [
        danglingId,
        sessionId,
        999001,
        JSON.stringify({
          blocks: [
            {
              type: "tool_result",
              toolUseId: "tu-dangle",
              content: "",
              contentRef: readRef({
                path: "/ghost.txt",
                entryId: 987654,
                version: 3,
                contentHash: "deadbeef",
              }),
            },
          ],
        }),
        Date.now(),
      ]
    );
    const dangling = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(dangling.done, true, "悬空 pair 不阻断本轮收敛");
    assert.equal(dangling.failedCount, 1, "悬空 pair 归坏行（占位 + warn）");
    assert.equal(
      await contentJsonOf(danglingId),
      JSON.stringify({
        blocks: [
          {
            type: "tool_result",
            toolUseId: "tu-dangle",
            content: JSON.stringify({
              path: "/ghost.txt",
              error:
                "revision 行缺失（entryId=987654, version=3）：引用悬空，ref_count 保活链已被破坏或引用键被篡改；回迁已落错误占位，正文不可恢复",
            }),
          },
        ],
      }),
      "悬空 pair 必须落错误占位 JSON"
    );
  });
});

describe("message-ref-unref: T-UM3 同事务性", () => {
  /** 让 tx 句柄上的 vfs_revision 批改抛错（模拟 −1 失败）。 */
  function connWithFailingRefDelta(): {
    wrapped: TdbcConnection;
    restore: () => void;
  } {
    const base = conn();
    const originalTransaction = base.transaction.bind(base);
    let injected = 0;
    const wrapped = {
      ...base,
      query: (sql: string, params?: readonly unknown[]) => base.query(sql, params),
      execute: (sql: string, params?: readonly unknown[]) =>
        base.execute(sql, params),
      batch: (sql: string, paramsList: readonly (readonly unknown[])[]) =>
        base.batch(sql, paramsList),
      close: () => base.close(),
      transaction: <T>(fn: (tx: TdbcConnection) => Promise<T>): Promise<T> =>
        originalTransaction(async (tx) => {
          const txExecute = tx.execute.bind(tx);
          return fn({
            ...tx,
            execute: (sql: string, params?: readonly unknown[]) => {
              if (
                injected < 1 &&
                typeof sql === "string" &&
                sql.includes("UPDATE vfs_revision")
              ) {
                injected += 1;
                return Promise.reject(
                  new Error("注入：ref_count 批改失败（模拟库被锁）")
                );
              }
              return txExecute(sql, params);
            },
          });
        }),
    } as TdbcConnection;
    return {
      wrapped,
      restore: () => undefined,
    };
  }

  it("−1 失败时写回同事务回滚（不产生半迁移行）", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um3");
    const plain = "同事务性夹具明文";
    const rev = await seedRevision(projectId, sessionId, plain);
    await setRefCount(rev.entryId, rev.version, 2);
    const id = await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-tx",
          content: "",
          contentRef: readRef({
            path: rev.path,
            entryId: rev.entryId,
            version: rev.version,
            contentHash: rev.contentHash,
          }),
        },
      ],
    });

    const { wrapped } = connWithFailingRefDelta();
    await assert.rejects(
      () => runMessageRefUnref(wrapped, { syncBudgetMs: 5_000 }),
      /注入/,
      "−1 失败必须把错误抛给调用方"
    );

    assert.equal(
      await contentJsonOf(id),
      JSON.stringify({
        blocks: [
          {
            type: "tool_result",
            toolUseId: "tu-tx",
            content: "",
            contentRef: readRef({
              path: rev.path,
              entryId: rev.entryId,
              version: rev.version,
              contentHash: rev.contentHash,
            }),
          },
        ],
      }),
      "同事务回滚：写回必须一并撤销（否则 ref_count 永久泄漏）"
    );
    assert.equal(
      await refCountOf(rev.entryId, rev.version),
      2,
      "失败事务不得留下 −1 痕迹"
    );
    assert.equal(await pendingCount(), 1, "行必须仍在谓词里（可续跑）");

    // 中断后重跑：无泄漏、无双减。
    const retry = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(retry.done, true);
    assert.equal(retry.unrefedCount, 1);
    assert.equal(
      await refCountOf(rev.entryId, rev.version),
      1,
      "重跑后恰好 −1（无泄漏、无双减）"
    );
    assert.equal(await pendingCount(), 0);
  });
});

describe("message-ref-unref: T-UM4 假阳性收敛", () => {
  it("正文含 contentRef 字面量的行归 failedIds、任务收敛置标记、不 −1", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um4");
    const rev = await seedRevision(projectId, sessionId, "不该被碰的明文");
    await setRefCount(rev.entryId, rev.version, 1);
    // 假阳性夹具必须是**裸 JSON**：`JSON.stringify` 会把用户正文里的引号转义成
    // `\"contentRef\"`，序列 `"contentRef"` 根本不会出现（D12 带引号谓词正是
    // 靠这条论证把假阳性压到近零）。仍能命中谓词的现实形态是**未知字段**里
    // 带着这个键序列（parse 白名单静默忽略未知字段、不回构 → 解析后无引用块）。
    const falsePositiveJson =
      '{"blocks":[{"type":"text","text":"排查方法"},{"type":"tool_result","toolUseId":"tu-fp","content":"输出","note":{"contentRef":"历史字段"}}]}';
    const id = await insertRefRow({
      sessionId,
      blocks: [],
      rawJson: falsePositiveJson,
    });

    const result = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(result.done, true, "假阳性行不得让任务永不收敛");
    assert.equal(result.noRefBlockCount, 1, "假阳性单独计数（区别于坏行）");
    assert.equal(result.failedCount, 0, "假阳性不是数据问题");
    assert.equal(result.unrefedCount, 0, "不得对该行下发写回");
    assert.equal(
      await contentJsonOf(id),
      falsePositiveJson,
      "正文一字未改"
    );
    assert.equal(
      await refCountOf(rev.entryId, rev.version),
      1,
      "无引用块 → 绝不 −1"
    );

    const marker = JSON.parse((await doneMarkerValue()) ?? "{}");
    assert.deepEqual(
      marker.failedIds,
      [id],
      "假阳性行必须进标记的 failedIds（入口探针靠它排除）"
    );
    assert.equal(marker.noRefBlockCount, 1);

    // 入口探针：标记命中 + 排除 failedIds → 零成本短路（不重扫全表）。
    const second = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(second.done, true);
    assert.equal(second.unrefedCount, 0);
    // 探针排除口径：清标记重跑时，假阳性行被判无需回迁、任务仍收敛。
    await conn().execute(
      "DELETE FROM kkv_entry WHERE module = ? AND key = ?",
      [MESSAGE_REF_UNREF_KKV_MODULE, MESSAGE_REF_UNREF_KKV_KEY]
    );
    const third = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(third.done, true, "自愈重跑后仍收敛");
    assert.equal(third.noRefBlockCount, 1);
  });
});

describe("message-ref-unref: T-UM5 断点续跑 / 标记自愈 / 探针排除", () => {
  it("syncBudgetMs:0 造中间态，后续轮次续跑完成（不双减）", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um5a");
    const rev = await seedRevision(projectId, sessionId, "续跑明文");
    await setRefCount(rev.entryId, rev.version, 2);
    await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-resume",
          content: "",
          contentRef: readRef({
            path: rev.path,
            entryId: rev.entryId,
            version: rev.version,
            contentHash: rev.contentHash,
          }),
        },
      ],
    });

    const first = await runMessageRefUnref(conn(), { syncBudgetMs: 0 });
    assert.equal(first.done, false, "0 预算必须立即返回不收敛");
    assert.equal(first.stalled, false);
    assert.equal(first.deferred, false);
    assert.equal(first.unrefedCount, 1, "已跑到的行照常落库");
    assert.equal(await pendingCount(), 0);
    assert.equal(
      await doneMarkerValue(),
      null,
      "未收敛不得置完成标记"
    );

    const second = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(second.done, true, "续跑必须收敛");
    assert.equal(
      await refCountOf(rev.entryId, rev.version),
      1,
      "续跑不得二次 −1"
    );
  });

  it("标记自愈：标记已置但库里又有引用行（快照回灌）→ 清标记续搬", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um5b");
    // 先跑一轮空库把标记置上（模拟「已完成」）。
    const empty = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(empty.done, true);
    assert.notEqual(await doneMarkerValue(), null);

    const rev = await seedRevision(projectId, sessionId, "回灌后的明文");
    await setRefCount(rev.entryId, rev.version, 2);
    const id = await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-heal",
          content: "",
          contentRef: readRef({
            path: rev.path,
            entryId: rev.entryId,
            version: rev.version,
            contentHash: rev.contentHash,
          }),
        },
      ],
    });

    const healed = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(healed.done, true);
    assert.equal(healed.unrefedCount, 1, "探针命中 → 清标记续搬");
    assert.equal(await pendingCount(), 0);
    assert.deepEqual(toolResultContents(await contentJsonOf(id)), [
      JSON.stringify({ path: rev.path, content: "回灌后的明文" }),
    ]);
    assert.equal(await refCountOf(rev.entryId, rev.version), 1);
  });

  it("探针 failedIds 排除三档：0 条 / 1 条 / 2 条", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um5c");

    // 档 0：failedIds 空清单 —— 库里有 2 条假阳性行，探针必命中（NOT IN 分支
    // 走不到），应触发自愈续搬并把两行都判无需回迁。
    const fpJson = (n: string): string =>
      `{"blocks":[{"type":"text","text":"假阳性 ${n}","note":{"contentRef":"历史字段"}}]}`;
    const fp1 = await insertRefRow({
      sessionId,
      blocks: [],
      rawJson: fpJson("一"),
    });
    const fp2 = await insertRefRow({
      sessionId,
      blocks: [],
      rawJson: fpJson("二"),
    });
    const r0 = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(r0.done, true);
    assert.equal(r0.noRefBlockCount, 2);
    const marker0 = JSON.parse((await doneMarkerValue()) ?? "{}");
    assert.deepEqual([...marker0.failedIds].sort(), [fp1, fp2].sort());

    // 档 2：标记已在位，探针带 failedIds 排除 → 零命中 → 标记短路保留
    // （不再白扫全表、也不清标记）。
    const markerBefore = await doneMarkerValue();
    const r1 = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(r1.done, true);
    assert.equal(r1.unrefedCount, 0, "短路路径不得重搬");
    assert.equal(
      r1.noRefBlockCount,
      2,
      "短路路径回放标记快照计数（与解压兄弟任务同款口径）"
    );
    assert.equal(
      await doneMarkerValue(),
      markerBefore,
      "排除生效则不清标记、不重写（含 at 时间戳）"
    );

    // 探针是活的：再落一条真引用行 → 探针命中 → 自愈续搬（证明短路不是
    // 「无脑短路」而是「排除后无命中才短路」）。
    const rev = await seedRevision(
      projectId,
      sessionId,
      "探针存活验证的明文"
    );
    await setRefCount(rev.entryId, rev.version, 2);
    await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-probe",
          content: "",
          contentRef: readRef({
            path: rev.path,
            entryId: rev.entryId,
            version: rev.version,
            contentHash: rev.contentHash,
          }),
        },
      ],
    });
    const r2 = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(r2.done, true);
    assert.equal(r2.unrefedCount, 1, "探针命中真引用行 → 自愈续搬");
    assert.equal(
      await pendingCount(),
      2,
      "真引用行已归零；残留的 2 行正是按设计永留谓词的假阳性行"
    );
    assert.equal(
      await refCountOf(rev.entryId, rev.version),
      1,
      "自愈续搬同样精确 −1"
    );
  });
});

describe("message-ref-unref: T-UM6 坏行三判别 + hash 不匹配", () => {
  it("revision 缺失 / blob 缺失 / status=deleted 三种坏行 → 错误占位 + 排除；hash 不匹配照常回填", async () => {
    await clearMarkers();
    await dropAllRefRows();
    await markDecompressDone();
    const { projectId, sessionId } = await newSession("um6");

    // ① blob 缺失：真写路径造 revision 后删掉 blob 行（并清进程内解压缓存，
    // 否则内存层会替我们把明文答上来，坏行根本触发不了）。
    const blobMiss = await seedRevision(projectId, sessionId, "blob 缺失的明文");
    await conn().execute(
      "DELETE FROM vfs_content_blob WHERE content_hash = ?",
      [blobMiss.contentHash]
    );
    clearDecodedContentCaches();
    const idBlobMiss = await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-blobmiss",
          content: "",
          contentRef: readRef({
            path: blobMiss.path,
            entryId: blobMiss.entryId,
            version: blobMiss.version,
            contentHash: blobMiss.contentHash,
          }),
        },
      ],
    });

    // ② status=deleted：直接改状态（触发器只在 content_hash 变更时动 blob，
    // 改 status 不触发）。
    const deleted = await seedRevision(projectId, sessionId, "已删除的明文");
    await conn().execute(
      "UPDATE vfs_revision SET status = 'deleted' WHERE entry_id = ? AND version = ?",
      [deleted.entryId, deleted.version]
    );
    const idDeleted = await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-deleted",
          content: "",
          contentRef: readRef({
            path: deleted.path,
            entryId: deleted.entryId,
            version: deleted.version,
            contentHash: deleted.contentHash,
          }),
        },
      ],
    });

    // ③ hash 不匹配（不算坏行）：引用块里的 contentHash 写错，但 (entryId,
    // version) 指得到明文。
    const mismatch = await seedRevision(projectId, sessionId, "hash 错配的明文");
    await setRefCount(mismatch.entryId, mismatch.version, 2);
    const idMismatch = await insertRefRow({
      sessionId,
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-mismatch",
          content: "",
          contentRef: readRef({
            path: mismatch.path,
            entryId: mismatch.entryId,
            version: mismatch.version,
            contentHash: "0000000000000000000000000000000000000000000000000000000000000000",
          }),
        },
      ],
    });

    const result = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(result.done, true, "坏行不得阻断完成标记置位");
    assert.equal(result.failedCount, 2, "两种真坏行（blob 缺失 / deleted）");
    assert.equal(result.noRefBlockCount, 0);
    assert.equal(result.unrefedCount, 3, "三行都落库（两行是错误占位、一行是明文包）");

    const placeholderOf = async (
      id: string
    ): Promise<Record<string, unknown>> => {
      const [content] = toolResultContents(await contentJsonOf(id));
      assert.ok(content != null, "工具结果块应存在");
      return JSON.parse(content) as Record<string, unknown>;
    };

    assert.match(
      (await placeholderOf(idBlobMiss)).error as string,
      /明文不可取|blob 缺失/,
      "blob 缺失必须落错误占位"
    );
    assert.match(
      (await placeholderOf(idDeleted)).error as string,
      /status=deleted/,
      "status=deleted 必须落错误占位"
    );
    assert.equal(
      (await placeholderOf(idMismatch)).content,
      "hash 错配的明文",
      "hash 不匹配不算坏行：能取到就照常回填"
    );
    assert.equal(
      (await placeholderOf(idMismatch)).error,
      undefined,
      "hash 错配不得写进占位"
    );
    assert.equal(
      await refCountOf(mismatch.entryId, mismatch.version),
      1,
      "hash 错配行照常 −1"
    );
    assert.equal(await pendingCount(), 0, "坏行落占位后退出谓词");

    const marker = JSON.parse((await doneMarkerValue()) ?? "{}");
    assert.equal(marker.failedCount, 2);
    assert.deepEqual(
      (marker.failedIds as string[]).sort(),
      [idBlobMiss, idDeleted].sort(),
      "坏行进标记清单（观测面）"
    );
    assert.equal(
      marker.failedIds.includes(idMismatch),
      false,
      "hash 错配行不进 failedIds"
    );
  });
});

describe("message-ref-unref: T-UM7 压缩行交叠", () => {
  it("压缩行不被触碰；解压标记未置 → deferred=true 且不置标记；解压完成后回迁收敛", async () => {
    await clearMarkers();
    await dropAllRefRows();
    const { projectId, sessionId } = await newSession("um7");
    const plain = "压缩行的明文（含 contentRef 引用块）";
    const rev = await seedRevision(projectId, sessionId, plain);
    await setRefCount(rev.entryId, rev.version, 2);
    const content: MessageContent = {
      blocks: [
        {
          type: "tool_result",
          toolUseId: "tu-compressed",
          content: "",
          contentRef: readRef({
            path: rev.path,
            entryId: rev.entryId,
            version: rev.version,
            contentHash: rev.contentHash,
          }),
        },
      ],
    };
    // 压缩形态行：content_json 为空串、content_blob 非空 → 谓词排除。
    const compressedId = await insertRefRow({
      sessionId,
      blocks: [],
      blobPlain: JSON.stringify(content),
    });

    // 解压标记**未置**：本轮对压缩行零动作（谓词排除），收尾 deferred。
    const deferred = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(deferred.done, false);
    assert.equal(deferred.deferred, true, "解压标记未置 → deferred 让位");
    assert.equal(deferred.stalled, false);
    assert.equal(deferred.unrefedCount, 0);
    assert.equal(
      await doneMarkerValue(),
      null,
      "deferred 不得置完成标记"
    );
    assert.equal(
      await refCountOf(rev.entryId, rev.version),
      2,
      "压缩行不得被本任务减计数"
    );

    // 模拟解压兄弟任务完成：解回明文 + 置标记（用 codec 走真解码路径）。
    const row = await conn().query<{
      content_encoding: unknown;
      content_blob: unknown;
    }>(
      "SELECT content_encoding, content_blob FROM chat_message WHERE id = ?",
      [compressedId]
    );
    const decoded = decodeMessageContent(
      row[0]!.content_encoding,
      row[0]!.content_blob,
      compressedId
    );
    await conn().execute(
      "UPDATE chat_message SET content_json = ?, content_encoding = NULL, content_blob = NULL WHERE id = ?",
      [decoded, compressedId]
    );
    await markDecompressDone();

    const after = await runMessageRefUnref(conn(), { syncBudgetMs: 5_000 });
    assert.equal(after.done, true, "解压完成后本任务方可收敛置标记");
    assert.equal(after.deferred, false);
    assert.equal(after.unrefedCount, 1);
    assert.deepEqual(toolResultContents(await contentJsonOf(compressedId)), [
      JSON.stringify({ path: rev.path, content: plain }),
    ]);
    assert.equal(await refCountOf(rev.entryId, rev.version), 1);
    assert.notEqual(await doneMarkerValue(), null);
  });
});