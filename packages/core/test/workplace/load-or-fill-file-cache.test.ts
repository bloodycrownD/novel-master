/**
 * loadOrFillFileCache 读取侧降级单测（huge-card-import-crash）。
 *
 * 覆盖：超限文件（内联字符数 / 压缩 blob 字节）返回占位、不触发 vfs.read
 * 全文、不写 file_cache；查询失败 / 探测 null / cache 命中 / filename 档
 * 的回退与短路行为。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOrFillFileCache } from "../../src/domain/workplace/logic/load-or-fill-file-cache.js";
import { createMemorySessionKkv } from "../helpers/prompt-layout-test-helpers.js";
import type { VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";
import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import {
  CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES,
  CHARACTER_CARD_MAX_SINGLE_FILE_BYTES,
} from "../../src/domain/character-card/logic/character-card-limits.js";

/** 只实现 read / findContentSize 的探测专用 fake；read 调用即记数。 */
function fakeVfs(options: {
  readonly contentSize:
    | { kind: "inlineChars"; size: number; mtimeMs: number }
    | { kind: "blobCompressedBytes"; size: number; mtimeMs: number }
    | null
    | "throw";
  readonly content?: string;
}): VfsService & { readCalls: () => number } {
  let readCalls = 0;
  const vfs = {
    async read() {
      readCalls++;
      return {
        path: "/note.md",
        content: options.content ?? "hello",
        version: 1,
        mtimeMs: 123,
      };
    },
    async findContentSize() {
      if (options.contentSize === "throw") {
        throw new Error("probe unsupported");
      }
      return options.contentSize;
    },
  };
  return Object.assign(vfs, { readCalls: () => readCalls }) as unknown as VfsService &
    { readCalls: () => number };
}

const BASE = {
  sessionId: "s1",
  path: "/note.md",
  status: "full" as const,
};

describe("loadOrFillFileCache 读取侧降级", () => {
  it("内联行字符数超限：返回占位、不 read 全文、不写 file_cache", async () => {
    const sessionKkv = createMemorySessionKkv();
    const vfs = fakeVfs({
      contentSize: {
        kind: "inlineChars",
        size: CHARACTER_CARD_MAX_SINGLE_FILE_BYTES + 1,
        mtimeMs: 1751718000000,
      },
    });

    const result = await loadOrFillFileCache({ ...BASE, sessionKkv, vfs });

    assert.match(result.body, /^（文件过大，已跳过，约 \d+ 字符）$/);
    assert.equal(result.body.includes(`${CHARACTER_CARD_MAX_SINGLE_FILE_BYTES + 1}`), true);
    // 占位块携带真实 mtime（CR-1：渲染层会用它生成时间属性，不得是 0/1970）
    assert.equal(result.mtimeMs, 1751718000000);
    assert.equal(vfs.readCalls(), 0, "不得触发 vfs.read 全文");
    assert.equal(
      await sessionKkv.get("s1", SESSION_KKV_DOMAIN_FILE_CACHE, fileCacheKey("full", "/note.md")),
      null,
      "占位结果不得写入 file_cache"
    );
  });

  it("压缩 blob 字节超限（按 4× 折算闸门）：返回占位、不 read、不写 cache", async () => {
    const sessionKkv = createMemorySessionKkv();
    const vfs = fakeVfs({
      contentSize: {
        kind: "blobCompressedBytes",
        size: CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES + 1,
        mtimeMs: 1751718000000,
      },
    });

    const result = await loadOrFillFileCache({ ...BASE, sessionKkv, vfs });

    assert.match(result.body, /^（文件过大，已跳过，约 \d+ 字符）$/);
    assert.equal(result.mtimeMs, 1751718000000, "blob 占位同样携带真实 mtime");
    assert.equal(vfs.readCalls(), 0);
    assert.equal(
      await sessionKkv.get("s1", SESSION_KKV_DOMAIN_FILE_CACHE, fileCacheKey("full", "/note.md")),
      null
    );
  });

  it("blob 未超压缩闸门：走原 read 路径并写 cache", async () => {
    const sessionKkv = createMemorySessionKkv();
    const vfs = fakeVfs({
      contentSize: { kind: "blobCompressedBytes", size: 1024 },
      content: "正常正文",
    });

    const result = await loadOrFillFileCache({ ...BASE, sessionKkv, vfs });

    assert.equal(result.body, "正常正文");
    assert.equal(vfs.readCalls(), 1);
    assert.notEqual(
      await sessionKkv.get("s1", SESSION_KKV_DOMAIN_FILE_CACHE, fileCacheKey("full", "/note.md")),
      null
    );
  });

  it("探测抛错：保守回退原 read 路径（不阻断组装）", async () => {
    const sessionKkv = createMemorySessionKkv();
    const vfs = fakeVfs({ contentSize: "throw", content: "回退正文" });

    const result = await loadOrFillFileCache({ ...BASE, sessionKkv, vfs });

    assert.equal(result.body, "回退正文");
    assert.equal(vfs.readCalls(), 1);
  });

  it("探测返回 null（路径不存在/目录行）：走原 read 路径", async () => {
    const sessionKkv = createMemorySessionKkv();
    const vfs = fakeVfs({ contentSize: null, content: "兜底正文" });

    const result = await loadOrFillFileCache({ ...BASE, sessionKkv, vfs });

    assert.equal(result.body, "兜底正文");
    assert.equal(vfs.readCalls(), 1);
  });

  it("cache 命中：不探测不读，直接返回缓存", async () => {
    const sessionKkv = createMemorySessionKkv();
    await sessionKkv.set(
      "s1",
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/note.md"),
      JSON.stringify({ body: "缓存正文", mtimeMs: 42 })
    );
    const vfs = fakeVfs({
      contentSize: { kind: "inlineChars", size: CHARACTER_CARD_MAX_SINGLE_FILE_BYTES + 1 },
    });

    const result = await loadOrFillFileCache({ ...BASE, sessionKkv, vfs });

    assert.equal(result.body, "缓存正文");
    assert.equal(result.mtimeMs, 42);
    assert.equal(vfs.readCalls(), 0);
  });

  it("filename 档：不探测（原行为，缺失占位空串仍写 cache）", async () => {
    const sessionKkv = createMemorySessionKkv();
    const vfs = fakeVfs({
      contentSize: { kind: "inlineChars", size: CHARACTER_CARD_MAX_SINGLE_FILE_BYTES + 1 },
    });

    const result = await loadOrFillFileCache({
      ...BASE,
      sessionKkv,
      vfs,
      status: "filename",
    });

    assert.equal(result.body, "");
    assert.equal(vfs.readCalls(), 0);
    assert.notEqual(
      await sessionKkv.get(
        "s1",
        SESSION_KKV_DOMAIN_FILE_CACHE,
        fileCacheKey("filename", "/note.md")
      ),
      null
    );
  });
});
