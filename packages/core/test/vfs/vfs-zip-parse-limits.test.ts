/**
 * CS-09 ZIP 解析期体积/条数闸的验收（fix-spec/wave-c2.md §C2-8 H1/H2/H3/H4/H6）。
 *
 * 病症原形态：闸门写在**解压之后**（`validateVfsZipEntries` 的入参已经是解压完的
 * Map），解析期全程无闸 ⇒ 攻击者可控的 `uncompressedSize` 让几百 KB 的 zip
 * 能让 `inflateSync` 分配 GB 级。
 *
 * 观测面：抛出的 `VfsZipError.code`（+ 按消息收窄的错误形态）。RULE 明禁拿墙钟卡线，
 * 所以不计时；堆增量口径已随 H2 一起删（cr1-ctests P2-2：恒真断言，见 H2 注释）。
 *
 * 本文件用到的两个「中央目录改写」手法（都只改字段、不重新压缩）：
 * ① 改中央目录条目的 **method** 字段 → fflate 回退会抛
 *    `unknown compression type`，而本仓解析器在**条数闸之后**根本读不到它；
 * ② 改 EOCD 的 **centralDirSize** → 本仓解析器判「中央目录条目截断」而失败，
 *    而 fflate 的 `unzipSync` **完全不使用这个字段**（实测 `zh()` 连
 *    `0x02014b50` 签名都不校验）⇒ 必然落到回退分支。
 *
 * CR-F05 追加的 4 条正向用例（H7..H10）：CS-09 这组用例原本**全在测「该抛的抛」**，
 * 没有一条测「不该抛的不抛」，于是 `decompressEntryData` 里那道把本条算两遍的
 * `remainingBudget` 兜底闸一路绿灯放行——实测 20 MiB 单条 DEFLATE、10 × 3 MiB
 * DEFLATE（总额 30 MiB < 32 MiB 上限）全被误判 `PAYLOAD_TOO_LARGE`，同内容 STORE
 * 却通过（STORE 分支提前 return，压根走不到那道闸）。四条正向用例各配一条 STORE
 * 对照，钉住「压缩方式不影响总量判定」这个本应成立的不变量。
 * 错误码断言同时按**消息**收窄：越限一律是 `exceeds limit`，而误拒类的
 * `exceeds remaining size budget` 随该闸删除后不再可能出现在任何报错里
 * （`expectZipCode` 对每条抛错用例都做这层反向断言）。
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

/**
 * 误杀消息（CR-F05 已删的那道闸的专属文案）。
 *
 * 它是**双计**的唯一可观测痕迹：合法包被误拒时报错一定是这句，而真正的越限永远
 * 是 `exceeds limit`。留成常量供断言「抛错时不得出现它」——文案改了就红，是刻意的。
 */
const MISJUDGED_REJECTION_MESSAGE = "exceeds remaining size budget";

/** 真·越限消息（条数闸 / 声明值总量闸 / 解压后总量闸 共用这个形态）。 */
const LIMIT_EXCEEDED_MESSAGE = "exceeds limit";

function expectZipCode(
  fn: () => unknown,
  code: string,
  messageFragment: string = LIMIT_EXCEEDED_MESSAGE
): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(
      e instanceof VfsZipError,
      `应抛 VfsZipError，实际：${String(e)}`
    );
    assert.equal(e.code, code, `错误码应为 ${code}，实际 ${e.code}：${e.message}`);
    // 按消息收窄：越限走 `exceeds limit`，错误码对了但消息不对同样算坏。
    assert.ok(
      e.message.includes(messageFragment),
      `消息应含 ${JSON.stringify(messageFragment)}，实际：${e.message}`
    );
    assert.ok(
      !e.message.includes(MISJUDGED_REJECTION_MESSAGE),
      `不该出现误杀文案 ${JSON.stringify(MISJUDGED_REJECTION_MESSAGE)}（CR-F05 已删该闸）：${e.message}`
    );
    return true;
  });
}

/** 可压缩的确定性填充（周期 251，DEFLATE 能压到极小，STORE 原样）。 */
function fillPattern(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = (i * 7 + seed * 13) % 251;
  }
  return bytes;
}

/** count 条、每条 bodySize 字节的确定性可压正文（供 H8/H10 复用）。 */
function manyFillEntries(
  count: number,
  bodySize: number
): {
  payload: Record<string, Uint8Array>;
  contents: Map<string, Uint8Array>;
} {
  const payload: Record<string, Uint8Array> = {};
  const contents = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const name = `c${String(i).padStart(2, "0")}.bin`;
    const body = fillPattern(bodySize, i);
    payload[name] = body;
    contents.set(name, body);
  }
  return { payload, contents };
}

/** 逐字节相等（分块 Buffer.compare；20 MiB 量级下全量 assert.deepEqual 太慢）。 */
function assertBytesEqual(
  actual: Uint8Array,
  expected: Uint8Array,
  label: string
): void {
  assert.equal(actual.length, expected.length, `${label}: 长度应相等`);
  const chunk = 1024 * 1024;
  for (let off = 0; off < expected.length; off += chunk) {
    const len = Math.min(chunk, expected.length - off);
    assert.equal(
      Buffer.from(actual.buffer, actual.byteOffset + off, len).compare(
        Buffer.from(expected.buffer, expected.byteOffset + off, len)
      ),
      0,
      `${label}: 第 ${off} 起的 ${len} 字节不一致`
    );
  }
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

  it("H2: 声明 33MB 的单条 entry 在解压之前抛 PAYLOAD_TOO_LARGE", () => {
    const zip = zipSync({ "big.md": new Uint8Array([1, 2, 3, 4]) }, { level: 0 });
    const eocd = findEocd(zip);
    // 中央目录首条目 uncompressedSize 字段（条目起点 + 24）谎报 33MB。
    writeU32LE(
      zip,
      readU32LE(zip, eocd + 16) + 24,
      VFS_ZIP_MAX_UNCOMPRESSED_BYTES + 1024 * 1024
    );

    // 本条**只钉「闸门存在且读的是声明值」**：错误码 + 消息形态都对，才说明解析期
    // 拿中央目录里的 uncompressedSize 判了限（真实正文仍是 4 字节，闸门挪到解压
    // 之后也会抛同一个码，所以本条分不出这两种实现）。
    //
    // 原先这里的「堆增量 < 8MB」已删（cr1-ctests P2-2：恒真断言）——夹具真身只有
    // 4 字节，无论闸门在解压前还是退回旧形态，堆增量都在几十 KB 量级，该断言在
    // 任何实现下都成立，信息量为零。「未真解压」这一维度改由 H7-H10 间接覆盖：
    // 那四条是真的把 20MiB / 10×3MiB 的正文喂进去逐字节比对，只有「解压后才判」
    // 的实现才会在它们身上露出体量/耗时形态。
    expectZipCode(() => parseVfsZip(zip), "PAYLOAD_TOO_LARGE");
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

/**
 * CR-F05 正面牙齿：**不该抛的不能抛**。
 *
 * 被删掉的那道 `remainingBudget` 兜底闸用「已含本条」的累计值当余额，再拿本条
 * 声明值去比 ⇒ 本条被算两遍，等价的误杀条件是 `前缀累计 + 2 × 本条 > 32 MiB`。
 * 下面的输入全部**远低于** 32 MiB 上限，旧代码必红（实测 H7/H8 两条 not ok，
 * 两条 STORE 对照恒绿）——这正是病症的形状：同一份内容，压不压缩结论不同。
 */
describe("CR-F05: 合法大体积归档不被误杀", () => {
  const MIB = 1024 * 1024;

  it("H7: 单条 20MiB DEFLATE 解析成功且内容逐字节相等", () => {
    const content = fillPattern(20 * MIB, 1);
    const zip = zipSync({ "big.md": content }, { level: 6 });
    // 自证确实走了 DEFLATE（否则本用例会悄悄退化成 STORE 对照，形同虚设）。
    assert.ok(zip.length < MIB, `20MiB 可压内容不该产出 ${zip.length} 字节归档`);

    const parsed = parseVfsZip(zip);
    assert.equal(parsed.size, 1);
    assertBytesEqual(parsed.get("big.md")!, content, "20MiB DEFLATE");
  });

  it("H8: 10 × 3MiB DEFLATE（总额 30MiB < 32MiB 上限）解析成功", () => {
    const { payload, contents } = manyFillEntries(10, 3 * MIB);
    const zip = zipSync(payload, { level: 6 });
    assert.ok(zip.length < 10 * MIB, "10 × 3MiB 可压内容不该近原样");

    const parsed = parseVfsZip(zip);
    assert.equal(parsed.size, 10);
    for (const [name, body] of contents) {
      assertBytesEqual(parsed.get(name)!, body, `DEFLATE ${name}`);
    }
  });

  it("H9: 对照——同内容 STORE 单条 20MiB 同样解析成功（压缩方式不影响总量判定）", () => {
    const content = fillPattern(20 * MIB, 1);
    const zip = zipSync({ "big.md": content }, { level: 0 });
    assert.ok(zip.length >= 20 * MIB, "STORE 对照应当几乎不压缩");

    const parsed = parseVfsZip(zip);
    assert.equal(parsed.size, 1);
    assertBytesEqual(parsed.get("big.md")!, content, "20MiB STORE");
  });

  it("H10: 对照——同内容 STORE 10 × 3MiB 同样解析成功（压缩方式不影响总量判定）", () => {
    const { payload, contents } = manyFillEntries(10, 3 * MIB);
    const zip = zipSync(payload, { level: 0 });

    const parsed = parseVfsZip(zip);
    assert.equal(parsed.size, 10);
    for (const [name, body] of contents) {
      assertBytesEqual(parsed.get(name)!, body, `STORE ${name}`);
    }
  });
});