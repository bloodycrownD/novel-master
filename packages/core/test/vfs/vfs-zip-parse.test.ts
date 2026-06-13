import assert from "node:assert/strict";
import { describe, it } from "node:test";
import iconv from "iconv-lite";
import { strToU8, zipSync } from "fflate";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { decodeZipEntryName, ZIP_GPBF_UTF8_EFS } from "../../src/domain/vfs/logic/vfs-zip-filename-decode.js";
import { parseVfsZip } from "../../src/domain/vfs/logic/vfs-zip-parse.js";
import { buildGbkFilenameZip } from "./helpers/gbk-zip-fixture.js";

const EOCD_SIGNATURE = 0x06054b50;

/** 损坏中央目录签名，保留 local entry 供 unzipSync 扫描。 */
function buildCentralDirCorruptZip(): Uint8Array {
  const zipBytes = zipSync({ "a.md": strToU8("hi") });
  const copy = new Uint8Array(zipBytes);
  for (let i = copy.length - 22; i >= 0; i--) {
    const sig =
      (copy[i]! |
        (copy[i + 1]! << 8) |
        (copy[i + 2]! << 16) |
        (copy[i + 3]! << 24)) >>>
      0;
    if (sig !== EOCD_SIGNATURE) {
      continue;
    }
    const centralDirOffset =
      copy[i + 16]! |
      (copy[i + 17]! << 8) |
      (copy[i + 18]! << 16) |
      (copy[i + 19]! << 24);
    copy[centralDirOffset] = 0x00;
    break;
  }
  return copy;
}

describe("parseVfsZip", () => {
  it("UTF-8 EFS：buildVfsZip 中文路径往返一致", () => {
    const files = new Map([
      ["笔记/第一章.md", "# 标题\n正文"],
      ["readme.md", "ascii"],
    ]);
    const zipBytes = buildVfsZip(files);
    const entries = parseVfsZip(zipBytes);

    assert.ok(entries.has("笔记/第一章.md"));
    assert.ok(entries.has("readme.md"));
    assert.equal(
      new TextDecoder().decode(entries.get("笔记/第一章.md")!),
      "# 标题\n正文",
    );
    assert.equal(new TextDecoder().decode(entries.get("readme.md")!), "ascii");
  });

  it("GBK：手工 fixture 解码中文路径", () => {
    const logicalPath = "笔记/第一章.md";
    const zipBytes = buildGbkFilenameZip([
      { logicalPath, content: "章节内容" },
    ]);
    const entries = parseVfsZip(zipBytes);

    assert.ok(entries.has(logicalPath));
    assert.equal(new TextDecoder().decode(entries.get(logicalPath)!), "章节内容");
  });

  it("CP437：纯 ASCII 文件名回归", () => {
    const rawName = new TextEncoder().encode("dir/readme.md");
    const name = decodeZipEntryName(rawName, 0);
    assert.equal(name, "dir/readme.md");

    const zipBytes = buildVfsZip(new Map([["dir/readme.md", "hello"]]));
    const entries = parseVfsZip(zipBytes);
    assert.ok(entries.has("dir/readme.md"));
    assert.equal(new TextDecoder().decode(entries.get("dir/readme.md")!), "hello");
  });

  it("decodeZipEntryName：EFS 标志优先于 GBK 启发式", () => {
    const utf8Bytes = new TextEncoder().encode("测试.md");
    const decoded = decodeZipEntryName(utf8Bytes, ZIP_GPBF_UTF8_EFS);
    assert.equal(decoded, "测试.md");
  });

  it("decodeZipEntryName：反斜杠归一化为正斜杠", () => {
    const raw = iconv.encode("笔记\\第一章.md", "gbk");
    const decoded = decodeZipEntryName(raw, 0);
    assert.equal(decoded, "笔记/第一章.md");
  });

  it("fflate zipSync 产物可由 parseVfsZip 解析", () => {
    const zipBytes = zipSync({ "fallback/a.md": strToU8("content") });
    const entries = parseVfsZip(zipBytes);
    assert.ok(entries.has("fallback/a.md"));
    assert.equal(new TextDecoder().decode(entries.get("fallback/a.md")!), "content");
  });

  it("中央目录解析失败时回退 unzipSync", () => {
    const zipBytes = buildCentralDirCorruptZip();
    const entries = parseVfsZip(zipBytes);
    assert.ok(entries.has("a.md"));
    assert.equal(new TextDecoder().decode(entries.get("a.md")!), "hi");
  });
});
