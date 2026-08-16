/**
 * T-CS1 / T-CS2：ContentStore put/get/gc（含他 session 引用不可误删）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteVfsContentStore } from "@/domain/vfs/content-store/impl/sqlite-vfs-content-store.js";
import { SqliteVfsEntryRepository } from "@/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import {
  bytesToBase64,
  VFS_CONTENT_ENCODING_ZLIB_B64,
} from "@/domain/vfs/content-store/logic/blob-bytes-codec.js";
import { hashContent } from "@/domain/vfs/content-store/logic/hash-content.js";
import {
  compressZlib,
  VFS_CONTENT_ENCODING_ZLIB,
} from "@/domain/vfs/content-store/logic/zlib-codec.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

describe("VfsContentStore", () => {
  it("T-CS1: 相同明文 → 相同 hash，blob 表仅一行", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const plain = `hello-cs1-${testIsolationSuffix()}`;
    const h1 = await store.put(plain);
    const h2 = await store.put(plain);
    assert.equal(h1, h2);
    assert.equal(h1, hashContent(plain));

    const rows = await conn.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vfs_content_blob WHERE content_hash = ?`,
      [h1],
    );
    assert.equal(Number(rows[0]!.n), 1);
  });

  it("T-CS2: put/get 往返；encoding=zlib；byte_len=压缩后长度", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn, { preferZlibB64: false });

    const cases = [
      "",
      "中文正文与标点，。！",
      `${"长正文".repeat(200)}-${testIsolationSuffix()}`,
    ];

    for (const plain of cases) {
      const hash = await store.put(plain);
      const got = await store.get(hash);
      assert.equal(got, plain);

      const meta = await conn.query<{
        encoding: string;
        byte_len: number;
        bytes: Uint8Array;
      }>(
        `SELECT encoding, byte_len, bytes FROM vfs_content_blob WHERE content_hash = ?`,
        [hash],
      );
      assert.equal(meta.length, 1);
      assert.equal(meta[0]!.encoding, VFS_CONTENT_ENCODING_ZLIB);
      assert.ok(meta[0]!.bytes instanceof Uint8Array);
      assert.equal(Number(meta[0]!.byte_len), meta[0]!.bytes.byteLength);
      assert.notEqual(String(meta[0]!.bytes), "[object Object]");
    }
  });

  it("zlib-b64: preferZlibB64 put/get 往返；byte_len=base64 字符串长度", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn, { preferZlibB64: true });
    const plain = `rn-b64-${testIsolationSuffix()}-中文`;

    const hash = await store.put(plain);
    assert.equal(await store.get(hash), plain);

    const meta = await conn.query<{
      encoding: string;
      byte_len: number;
      bytes: string;
    }>(
      `SELECT encoding, byte_len, bytes FROM vfs_content_blob WHERE content_hash = ?`,
      [hash],
    );
    assert.equal(meta.length, 1);
    assert.equal(meta[0]!.encoding, VFS_CONTENT_ENCODING_ZLIB_B64);
    assert.equal(typeof meta[0]!.bytes, "string");
    assert.equal(Number(meta[0]!.byte_len), meta[0]!.bytes.length);
  });

  it("get：encoding=zlib 且 bytes 为 base64 string 时兜底解码", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn, { preferZlibB64: false });
    const plain = `legacy-zlib-string-${testIsolationSuffix()}`;
    const contentHash = hashContent(plain);
    const compressed = compressZlib(new TextEncoder().encode(plain));
    const b64 = bytesToBase64(compressed);

    // 模拟存量：encoding 仍标 zlib，但列里实际是 base64 文本（RN 读回形态）。
    await conn.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
       VALUES (?, ?, ?, ?)`,
      [contentHash, VFS_CONTENT_ENCODING_ZLIB, b64, b64.length],
    );

    assert.equal(await store.get(contentHash), plain);
  });

  it("get：手动插入 zlib-b64 行可按 encoding 解码", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const plain = `manual-b64-${testIsolationSuffix()}`;
    const contentHash = hashContent(plain);
    const compressed = compressZlib(new TextEncoder().encode(plain));
    const b64 = bytesToBase64(compressed);

    await conn.execute(
      `INSERT INTO vfs_content_blob (content_hash, encoding, bytes, byte_len)
       VALUES (?, ?, ?, ?)`,
      [contentHash, VFS_CONTENT_ENCODING_ZLIB_B64, b64, b64.length],
    );

    assert.equal(await store.get(contentHash), plain);
  });

  it("同 hash 复用行不改 encoding（Node 行不被 RN put 改写）", async () => {
    const { conn } = getNovelMasterTestContext();
    const plain = `reuse-encoding-${testIsolationSuffix()}`;
    const nodeStore = new SqliteVfsContentStore(conn, {
      preferZlibB64: false,
    });
    const rnStore = new SqliteVfsContentStore(conn, { preferZlibB64: true });

    const hash = await nodeStore.put(plain);
    await rnStore.put(plain);

    const meta = await conn.query<{ encoding: string }>(
      `SELECT encoding FROM vfs_content_blob WHERE content_hash = ?`,
      [hash],
    );
    assert.equal(meta[0]!.encoding, VFS_CONTENT_ENCODING_ZLIB);
    assert.equal(await rnStore.get(hash), plain);
  });

  it("gc：删除孤立 blob，保留被 vfs_entry 引用的 blob", async () => {
    const { conn } = getNovelMasterTestContext();
    const store = new SqliteVfsContentStore(conn);
    const entryRepo = new SqliteVfsEntryRepository(conn);
    const suffix = testIsolationSuffix();
    const sk = `test-scope-gc-${suffix}`;

    // hashA 被 vfs_entry 引用 → gc 后应保留。
    const hashA = await store.put(`entry-referenced-${suffix}`);
    await entryRepo.insertWithContentHash(sk, "/kept.md", hashA);

    // hashB 无人引用 → 孤立，gc 后应被删。
    const hashB = await store.put(`orphan-${suffix}`);

    const deleted = await store.gc();
    // 共享内存库里可能有先前用例遗留的孤立 blob，所以只断言「至少删了 hashB」。
    assert.ok(deleted >= 1, `gc 应至少清扫 1 个孤立 blob，实际 ${deleted}`);

    assert.equal(await store.get(hashA), `entry-referenced-${suffix}`);
    await assert.rejects(() => store.get(hashB));
  });
});
