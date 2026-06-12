import assert from "node:assert/strict";
import { describe, it } from "node:test";
import iconv from "iconv-lite";
import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { decodeZipEntryName, ZIP_GPBF_UTF8_EFS } from "../../src/domain/vfs/logic/vfs-zip-filename-decode.js";
import { parseVfsZip } from "../../src/domain/vfs/logic/vfs-zip-parse.js";
import { buildGbkFilenameZip } from "./helpers/gbk-zip-fixture.js";

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
});
