/**
 * CS-09 ZIP 解析期体积/条数闸的验收（fix-spec/wave-c2.md §C2-8 H1/H2/H3/H4/H6）。
 *
 * 病症原形态：闸门写在**解压之后**（`validateVfsZipEntries` 的入参已经是解压完的
 * Map），解析期全程无闸 ⇒ 攻击者可控的 `uncompressedSize` 让几百 KB 的 zip
 * 能让 `inflateSync` 分配 GB 级。
 *
 * 观测面：抛出的 `VfsZipError.code`、以及「有没有真解压」（堆增量上界）。
 * RULE 明禁拿墙钟卡线，所以不计时。
 *
 * 本文件用到的两个「中央目录改写」手法（都只改字段、不重新压缩）：
 * ① 改中央目录条目的 **method** 字段 → fflate 回退会抛
 *    `unknown compression type`，而本仓解析器在**条数闸之后**根本读不到它；
 * ② 改 EOCD 的 **centralDirSize** → 本仓解析器判「中央目录条目截断」而失败，
 *    而 fflate 的 `unzipSync` **完全不使用这个字段**（实测 `zh()` 连
 *    `0x02014b50` 签名都不校验）⇒ 必然落到回退分支。
 *
 * @module test/vfs/vfs-zip-parse-limits
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unzipSync, zipSync } from "fflate";
import { parseVfsZip } from "../../src/domain/vfs/logic/vfs-zip-parse.js";
import { previewSkillZip } from "@/domain/skills/logic/preview-skill-zip.js";
import {
  VFS_ZIP_MAX_ENTRY_COUNT,
  VFS_ZIP_MAX_ENTRY_PATH_LEN,
  VFS_ZIP_MAX_UNCOMPRESSED_BYTES,
} from "../../src/domain/vfs/logic/vfs-zip-validate.js";
import { VfsZipError } from "../../src/errors/vfs-zip-errors.js";

const EOCD_SIG = 0x06054b50;

function readU16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) >>> 0;
}

function writeU16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function findEocd(bytes: Uint8Array): number {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (readU32LE(bytes, i) === EOCD_SIG) {
      return i;
    }
  }
  throw new Error("EOCD not found");
}

/** 第一条中央目录条目里 compression method 字段（offset + 10）的绝对位置。 */
function firstCentralDirMethodOffset(bytes: Uint8Array): number {
  const eocd = findEocd(bytes);
  return readU32LE(bytes, eocd + 16) + 10;
}

/** n 个空 STORE 条目的 zip。 */
function manyEmptyEntries(count: number): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (let i = 0; i < count; i++) {
    payload[`e${String(i).padStart(5, "0")}.md`] = new Uint8Array(0);
  }
  return zipSync(payload, { level: 0 });
}

function expectZipCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(
      e instanceof VfsZipError,
      `应抛 VfsZipError，实际：${String(e)}`
    );
    assert.equal(e.code, code, `错误码应为 ${code}，实际 ${e.code}：${e.message}`);
    return true;
  });
}

describe("CS-09 ZIP 解析期闸门", () => {
  it("H6: 常量搬家不破坏既有 import 面（数值原样）", () => {
    assert.equal(VFS_ZIP_MAX_UNCOMPRESSED_BYTES, 32 * 1024 * 1024);
    assert.equal(VFS_ZIP_MAX_ENTRY_COUNT, 5_000);
    assert.equal(VFS_ZIP_MAX_ENTRY_PATH_LEN, 512);
  });

  it("H1: 5001 条 entry 的 zip 在解压任何一条之前就抛 PAYLOAD_TOO_LARGE", () => {
    const zip = manyEmptyEntries(VFS_ZIP_MAX_ENTRY_COUNT + 1);
    expectZipCode(() => parseVfsZip(zip), "PAYLOAD_TOO_LARGE");
    // 未越限的同款 zip 必须正常解析（断言不是恒真）。
    const ok = parseVfsZip(manyEmptyEntries(10));
    assert.equal(ok.size, 10);
  });

  it("H1 反证: 中央目录损坏 + 超条数 ⇒ 仍是 PAYLOAD_TOO_LARGE，绝不回退 fflate", () => {
    const zip = manyEmptyEntries(VFS_ZIP_MAX_ENTRY_COUNT + 1);
    // 让 fflate 的回退路径**必然抛错**（unknown compression type），
    // 于是「若闸门被当成解析失败而回退」这一支会产出 INVALID_ZIP。
    writeU16LE(zip, firstCentralDirMethodOffset(zip), 14);
    assert.throws(() => unzipSync(zip), /unknown compression type/);

    // 期望：条数闸在读到那条 method 之前就判掉。
    expectZipCode(() => parseVfsZip(zip), "PAYLOAD_TOO_LARGE");
  });

  it("H2: 声明 33MB 的单条 entry 在解压之前抛 PAYLOAD_TOO_LARGE（堆增量不随之暴涨）", () => {
    const zip = zipSync({ "big.md": new Uint8Array([1, 2, 3, 4]) }, { level: 0 });
    const eocd = findEocd(zip);
    // 中央目录首条目 uncompressedSize 字段（条目起点 + 24）谎报 33MB。
    writeU32LE(
      zip,
      readU32LE(zip, eocd + 16) + 24,
      VFS_ZIP_MAX_UNCOMPRESSED_BYTES + 1024 * 1024
    );

    // 先跑一次别的解析把 JIT/常量池预热，再测堆增量（避免首跑噪声）。
    parseVfsZip(zipSync({ "warm.md": new Uint8Array([1, 2, 3]) }, { level: 0 }));
    if (global.gc != null) {
      global.gc();
    }
    const before = process.memoryUsage().heapUsed;
    expectZipCode(() => parseVfsZip(zip), "PAYLOAD_TOO_LARGE");
    const deltaMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);
    assert.ok(
      deltaMb < 8,
      `堆增量 ${deltaMb.toFixed(2)}MB 过大：闸门没有真正挡在解压之前`
    );
  });

  it("H3: 技能预检走同一个解析器 ⇒ 同款 PAYLOAD_TOO_LARGE", () => {
    const zip = manyEmptyEntries(VFS_ZIP_MAX_ENTRY_COUNT + 1);
    expectZipCode(() => previewSkillZip(zip), "PAYLOAD_TOO_LARGE");

    // 对照：合法技能 zip 预检照常工作（断言不是恒真）。
    const good = zipSync(
      {
        "SKILL.md": new TextEncoder().encode(
          "---\nname: demo\ndescription: d\n---\n正文"
        ),
      },
      { level: 0 }
    );
    const preview = previewSkillZip(good);
    assert.equal(preview.name, "demo");
  });

  it("H4: 中央目录解析失败但解压后超 32MB ⇒ fflate 回退路径同样被闸门拦下", () => {
    // 33MB STORE 正文：解压后超过 32MB 上限。
    const oneMb = new Uint8Array(1024 * 1024);
    const payload: Record<string, Uint8Array> = {};
    for (let i = 0; i < 33; i++) {
      payload[`blob${i}.bin`] = oneMb;
    }
    const zip = zipSync(payload, { level: 0 });

    // 伪造 EOCD 的 centralDirSize：本仓解析器据此判「中央目录条目截断」而失败。
    const eocd = findEocd(zip);
    writeU32LE(zip, eocd + 12, 4);

    // 前提自证：fflate 自己能读（它不使用 centralDirSize 字段）。
    const raw = unzipSync(zip);
    assert.equal(Object.keys(raw).length, 33);

    // 期望：回退分支解完之后判限，抛 PAYLOAD_TOO_LARGE（抛点在 try 之外 ⇒
    // 不会被外层 catch 改写成 INVALID_ZIP）。
    expectZipCode(() => parseVfsZip(zip), "PAYLOAD_TOO_LARGE");
  });

  it("H4 对照: 同款中央目录破坏但体积未越限 ⇒ 回退路径正常解析（证明确实走到了 fflate）", () => {
    const zip = zipSync(
      { "a.txt": new Uint8Array([1, 2, 3]), "b.txt": new Uint8Array([4, 5]) },
      { level: 0 }
    );
    const eocd = findEocd(zip);
    writeU32LE(zip, eocd + 12, 4);

    const parsed = parseVfsZip(zip);
    assert.equal(parsed.size, 2);
    assert.deepEqual(Array.from(parsed.get("a.txt")!), [1, 2, 3]);
  });
});