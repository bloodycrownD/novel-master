/**
 * 消息正文压缩存储 codec 往返用例（T-C1 ~ T-C5、T-C12）。
 *
 * 混存自愈形态对齐 test/session-kkv/file-cache-store.test.ts 先例：
 * legacy 明文行用手工 INSERT 直插（模拟 e2e fixture），压缩行走
 * repository 编码写入，两种形态并存时 list/get 均正确还原。
 *
 * @module test/chat/message-content-codec-roundtrip
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import { ChatError } from "../../src/errors/chat-errors.js";
import {
  decompressZlib,
  VFS_CONTENT_ENCODING_ZLIB,
} from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import { encodeMessageContent } from "../../src/domain/chat/logic/message-content-codec.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { ChatMessage, MessageContent } from "../../src/domain/chat/model/message.js";
import type { ContentBlock } from "../../src/domain/chat/model/content-block.js";

novelMasterTestFixture();

/** 构造一条手造 ChatMessage。 */
function makeMessage(args: {
  sessionId: string;
  seq: number;
  role: string;
  content: MessageContent;
  createdAtMs?: number;
  hidden?: boolean;
}): ChatMessage {
  return {
    id: randomUUID(),
    sessionId: args.sessionId,
    seq: args.seq,
    role: args.role,
    content: args.content,
    provider: null,
    raw: null,
    createdAtMs: args.createdAtMs ?? Date.now(),
    hidden: args.hidden ?? false,
  };
}

/** 多块构造。 */
function blocksContent(...blocks: ContentBlock[]): MessageContent {
  return { blocks };
}

/** 新建一个会话并返回 repo。 */
async function newSession(): Promise<{
  sessionId: string;
  repo: SqliteMessageRepository;
}> {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
  return { sessionId: session.id, repo: new SqliteMessageRepository(ctx.conn) };
}

/**
 * 直查某行的压缩两列原始形态。
 *
 * ic-28②：contentJson 严格区分 ''（已压缩行——明文迁出置空串）与
 * null（legacy 行——两列皆 NULL 的明文形态），不做 `?? ""` 归一——
 * 「压缩后 content_json 应为空串而非 NULL」的契约靠 isNull === false
 * 与严格空串断言锁住。
 */
async function rawCompressionColumns(
  id: string
): Promise<{
  encoding: string | null;
  blob: Uint8Array | string | null;
  contentJson: string | null;
  isNull: boolean;
}> {
  const ctx = getNovelMasterTestContext();
  const rows = await ctx.conn.query<{
    content_encoding: string | null;
    content_blob: unknown;
    content_json: string | null;
  }>(
    "SELECT content_encoding, content_blob, content_json FROM chat_message WHERE id = ?",
    [id]
  );
  const row = rows[0]!;
  return {
    encoding: row.content_encoding,
    blob:
      row.content_blob == null
        ? null
        : row.content_blob instanceof Uint8Array
          ? row.content_blob
          : String(row.content_blob),
    contentJson: row.content_json == null ? null : String(row.content_json),
    isNull: row.content_json == null,
  };
}

describe("消息正文压缩存储 codec（T-C1 ~ T-C5、T-C12）", () => {
  it("T-C1：压缩往返——insert 落库为 zlib 二进制形态，content_json 置空，API 读回逐字节等价", async () => {
    const { sessionId, repo } = await newSession();
    const content = blocksContent(
      { type: "text", text: "【第一章】夜色渐深，少年推开客栈的木门……\n\t第二行带转义 \"引号\" 与 \\ 反斜杠" },
      { type: "tool_use", id: "tu1", name: "read", input: { path: "/a.md" } },
    );
    const message = makeMessage({ sessionId, seq: 1, role: "user", content, createdAtMs: 1 });
    await repo.insert(message);

    // SQL 层读出为压缩形态：encoding=zlib、blob 为二进制 BLOB、明文列空串
    // （ic-28②：严格空串断言 + isNull === false，区分 NULL 行）。
    const raw = await rawCompressionColumns(message.id);
    assert.equal(raw.encoding, "zlib");
    assert.ok(raw.blob instanceof Uint8Array, "content_blob 应为二进制形态");
    assert.equal(raw.contentJson, "");
    assert.equal(raw.isNull, false, "压缩行明文列应为空串而非 NULL");
    // zlib 二进制不是合法 UTF-8 明文（粗防退化为明文存储）。
    assert.notEqual(new TextDecoder().decode(raw.blob as Uint8Array), JSON.stringify(content));

    // 解压逐字节等价。
    const plain = new TextDecoder().decode(decompressZlib(raw.blob as Uint8Array));
    assert.equal(plain, JSON.stringify(content));

    // API 读回与原文逐字节等价（deepEqual 语义等价）。
    const read = await repo.findById(message.id);
    assert.ok(read);
    assert.deepEqual(read!.content, content);

    // listBySession 同样还原。
    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 1);
    assert.deepEqual(list[0]!.content, content);
  });

  it("T-C2：写侧无平台分支——encode 恒二进制 zlib；存量 zlib-b64 行读回等价（三形态兼容）", async () => {
    const { sessionId, repo } = await newSession();
    const ctx = getNovelMasterTestContext();
    const content = textBlocks("移动端 zlib-b64 形态验证：中文正文与 emoji 😀");
    const message = makeMessage({ sessionId, seq: 1, role: "assistant", content, createdAtMs: 2 });
    await repo.insert(message);

    // A2（blob-binary-normalization）起编码器无平台分支：三端恒 zlib +
    // 二进制（forceZlibB64 注入点已随 RN 写侧分支一并删除）。
    const encoded = encodeMessageContent(JSON.stringify(content));
    assert.equal(encoded.encoding, "zlib");
    assert.ok(encoded.blob instanceof Uint8Array, "写侧应恒为二进制形态");

    // 存量 zlib-b64 文本行（RN 旧版落库形态）手工直插，读路径三形态兼容
    // （decodeCompressedBytes）；该形态由归一任务的 chat_message 适配器搬运。
    const b64 = Buffer.from(encoded.blob).toString("base64");
    await ctx.conn.execute(
      `UPDATE chat_message SET content_json = '', content_encoding = 'zlib-b64', content_blob = ? WHERE id = ?`,
      [b64, message.id]
    );

    const raw = await rawCompressionColumns(message.id);
    assert.equal(raw.encoding, "zlib-b64");
    assert.equal(typeof raw.blob, "string");
    assert.equal(raw.contentJson, "");
    assert.equal(raw.isNull, false);

    const read = await repo.findById(message.id);
    assert.ok(read);
    assert.deepEqual(read!.content, content);

    // 第三形态（ic-24，A2 真机脏形态）：content_encoding='zlib' 但
    // content_blob 存的是 base64 文本——归一谓词第二 disjunct
    // （TYPEOF(content_blob) = 'text'）专为它存在。手工 UPDATE 造脏行，
    // repo.findById 读回与原文等价（标题「三形态兼容」的最后一块拼图）。
    await ctx.conn.execute(
      `UPDATE chat_message SET content_json = '', content_encoding = 'zlib', content_blob = ? WHERE id = ?`,
      [b64, message.id]
    );

    const rawZlibText = await rawCompressionColumns(message.id);
    assert.equal(rawZlibText.encoding, "zlib");
    assert.equal(typeof rawZlibText.blob, "string", "脏形态：blob 为 base64 文本");
    assert.equal(rawZlibText.contentJson, "");
    assert.equal(rawZlibText.isNull, false);

    const readZlibText = await repo.findById(message.id);
    assert.ok(readZlibText);
    assert.deepEqual(readZlibText!.content, content);
  });

  it("T-C3：混存自愈——legacy 明文行与压缩行并存，list/get 均正确还原", async () => {
    const { sessionId, repo } = await newSession();
    const ctx = getNovelMasterTestContext();

    // 压缩行：走 repository 编码写入。
    const compressedMsg = makeMessage({
      sessionId,
      seq: 1,
      role: "user",
      content: textBlocks("压缩形态消息"),
      createdAtMs: 1,
    });
    await repo.insert(compressedMsg);

    // legacy 明文行：手工 INSERT 明文（模拟 e2e fixture / 未搬运存量），
    // 不触碰压缩两列（全 NULL）。
    const legacyId = randomUUID();
    await ctx.conn.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, created_at_ms, hidden
       ) VALUES (?, ?, 2, 'assistant', ?, ?, 0)`,
      [legacyId, sessionId, '{"blocks":[{"type":"text","text":"legacy 明文形态消息"}]}', 2]
    );

    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0]!.content, textBlocks("压缩形态消息"));
    assert.deepEqual(list[1]!.content, textBlocks("legacy 明文形态消息"));

    // ic-28②：legacy 明文行的 content_json 是明文 JSON 文本（非 NULL 非
    // 空串）——与压缩行的严格空串形态互斥，两形态靠 isNull / 空串区分。
    const rawLegacy = await rawCompressionColumns(legacyId);
    assert.equal(rawLegacy.encoding, null);
    assert.equal(rawLegacy.blob, null);
    assert.notEqual(rawLegacy.contentJson, null);
    assert.equal(rawLegacy.isNull, false);

    const got = await repo.findById(legacyId);
    assert.ok(got);
    assert.deepEqual(got!.content, textBlocks("legacy 明文形态消息"));

    // tail / page 路径同样双形态还原。
    const tail = await repo.listBySessionTail(sessionId, 2);
    assert.equal(tail.length, 2);
    assert.deepEqual(tail[1]!.content, textBlocks("legacy 明文形态消息"));
  });

  it("T-C4：坏数据 fail-fast——损坏 blob 解压失败抛类型化错误（含消息 id），不静默丢行", async () => {
    const { sessionId, repo } = await newSession();
    const ctx = getNovelMasterTestContext();
    const message = makeMessage({
      sessionId,
      seq: 1,
      role: "user",
      content: textBlocks("即将被破坏的消息"),
      createdAtMs: 1,
    });
    await repo.insert(message);

    // 破坏 blob：截断的 zlib 流（非空、解压必失败）。
    const raw = await rawCompressionColumns(message.id);
    const blob = raw.blob as Uint8Array;
    const corrupted = blob.slice(0, Math.max(1, Math.floor(blob.byteLength / 2)));
    await ctx.conn.execute(
      `UPDATE chat_message SET content_blob = ? WHERE id = ?`,
      [corrupted, message.id]
    );

    await assert.rejects(
      () => repo.findById(message.id),
      (error: unknown) => {
        assert.ok(error instanceof ChatError, "应抛类型化 ChatError");
        assert.equal(error.code, "INVALID_ARGUMENT");
        assert.ok(
          error.message.includes(message.id),
          `错误文案应含消息 id：${error.message}`
        );
        return true;
      }
    );

    // 不静默丢行：listBySession 同样 fail-fast（而非跳过该行返回空）。
    await assert.rejects(() => repo.listBySession(sessionId));
  });

  it("T-C5：编辑路径——updateContent 写压缩、读回等价；port 新签名收口序列化", async () => {
    const { sessionId, repo } = await newSession();
    const original = textBlocks("编辑前内容");
    const message = makeMessage({ sessionId, seq: 1, role: "user", content: original, createdAtMs: 1 });
    await repo.insert(message);

    // 新签名直接传 MessageContent 对象（stringify 已下沉 repository）。
    const edited = blocksContent(
      { type: "thinking", text: "编辑后的思考" },
      { type: "text", text: "编辑后内容：更长的中文正文～" },
    );
    const updated = await repo.updateContent(message.id, edited);
    assert.equal(updated, true);

    const raw = await rawCompressionColumns(message.id);
    assert.equal(raw.encoding, "zlib");
    assert.ok(raw.blob instanceof Uint8Array);
    assert.equal(raw.contentJson, "");
    assert.equal(raw.isNull, false, "压缩行明文列应为空串而非 NULL");
    const plain = new TextDecoder().decode(decompressZlib(raw.blob as Uint8Array));
    assert.equal(plain, JSON.stringify(edited));

    const read = await repo.findById(message.id);
    assert.ok(read);
    assert.deepEqual(read!.content, edited);

    // 行缺失返回 false。
    assert.equal(await repo.updateContent(randomUUID(), edited), false);
  });

  it("T-C12：mobile e2e fixture 同款明文直插行在压缩版本下仍可读（双形态保证）", async () => {
    // 复刻 apps/mobile/e2e/fixtures/tool-turn-session.sql 的 INSERT 形态：
    // 显式列清单只含 content_json，不触碰压缩两列（新列 NULL 默认）。
    const { sessionId, repo } = await newSession();
    const ctx = getNovelMasterTestContext();
    await ctx.conn.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, provider, raw_json, created_at_ms, hidden
       ) VALUES (?, ?, 2, 'assistant', ?, NULL, NULL, ?, 0)`,
      [
        randomUUID(),
        sessionId,
        '{"blocks":[{"type":"thinking","text":"Let me read the file."},{"type":"text","text":"reading"},{"type":"tool_use","id":"tu1","name":"read","input":{"path":"/a.md"}}]}',
        Date.now(),
      ]
    );
    // fixture 同款 tool_result + hidden 行。
    await ctx.conn.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, provider, raw_json, created_at_ms, hidden
       ) VALUES (?, ?, 3, 'user', ?, NULL, NULL, ?, 1)`,
      [
        randomUUID(),
        sessionId,
        '{"blocks":[{"type":"tool_result","toolUseId":"tu1","content":"ok"}]}',
        Date.now() + 1,
      ]
    );

    const list = await repo.listBySession(sessionId);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0]!.content, {
      blocks: [
        { type: "thinking", text: "Let me read the file." },
        { type: "text", text: "reading" },
        { type: "tool_use", id: "tu1", name: "read", input: { path: "/a.md" } },
      ],
    });
    assert.deepEqual(list[1]!.content, {
      blocks: [{ type: "tool_result", toolUseId: "tu1", content: "ok" }],
    });
    assert.equal(list[1]!.hidden, true);
  });

  it("T-C1 补充：zlib 常量口径与 vfs 先例一致", () => {
    // 编码值域对齐 vfs_content_blob 先例（decodeCompressedBytes 共用前提）。
    assert.equal(VFS_CONTENT_ENCODING_ZLIB, "zlib");
  });
});
