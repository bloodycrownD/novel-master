/**
 * Node 侧原生 zlib 加速器（W1-P1-4）用例。
 *
 * 覆盖三层：
 *  1. 交叉兼容：`node:zlib` 产物 fflate 可解、fflate 产物 `node:zlib` 可解，
 *     解出明文字节逐字节等值（两种实现的压缩产物**不保证字节相等**，等价面
 *     是解压结果）；
 *  2. 注册后往返：zlib-codec（compressZlib/decompressZlib）与 pack-codec 两
 *     format 编解码真实走加速器（spy 计数佐证），往返等值；
 *  3. 防御与不变性：加速器返回 null / 抛错 → 回落 fflate 且产物与 fflate
 *     逐字节一致；未注册时全部路径与历史行为一致（fflate 产物字节等值）。
 *
 * 测试文件是 Node-only，可直接 import node:zlib；生产 core src 禁止静态
 * import node: 模块（Metro 打包约束），加速器一律经宿主注册生效。
 *
 * @module test/vfs/zlib-accelerator
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { deflateSync, inflateSync } from "node:zlib";
import { unzlibSync, zlibSync } from "fflate";
import {
  clearZlibCodecAccelerator,
  registerZlibCodecAccelerator,
  tryZlibDeflate,
  tryZlibInflate,
  type ZlibCodecAccelerator,
} from "../../src/domain/vfs/content-store/logic/zlib-accelerator.js";
import {
  compressZlib,
  decompressZlib,
} from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import {
  decodeFossilChainSpans,
  decodeZlibConcatSpans,
  encodeFossilChainPack,
  encodeZlibConcatPack,
} from "../../src/domain/vfs/content-store/logic/pack-codec.js";

/** 若后续用例忘记清理，注册会泄漏到同文件后续用例——每例后强制注销。 */
afterEach(() => {
  clearZlibCodecAccelerator();
});

/** 与宿主（desktop main / cli）同款注册实现。 */
const NODE_ACCELERATOR: ZlibCodecAccelerator = {
  deflate: (data, level) =>
    level === undefined ? deflateSync(data) : deflateSync(data, { level }),
  inflate: (data) => inflateSync(data),
};

/** 计数 spy：委托 node:zlib 并数调用，证「注册后确实走了加速器」。 */
function countingNodeAccelerator(): {
  readonly accel: ZlibCodecAccelerator;
  readonly counts: () => { deflates: number; inflates: number };
} {
  let deflates = 0;
  let inflates = 0;
  return {
    counts: () => ({ deflates, inflates }),
    accel: {
      deflate: (data, level) => {
        deflates += 1;
        return level === undefined ? deflateSync(data) : deflateSync(data, { level });
      },
      inflate: (data) => {
        inflates += 1;
        return inflateSync(data);
      },
    },
  };
}

const encoder = new TextEncoder();
const TEXT_PLAIN = encoder.encode(
  "落霞与孤鹜齐飞，秋水共长天一色。".repeat(2000)
);
const EMPTY_PLAIN = new Uint8Array(0);
/** 确定性二进制样本（含 0x00/0xFF、非 UTF-8 合法序列）。 */
const BINARY_PLAIN = Uint8Array.from(
  { length: 4096 },
  (_, index) => (index * 37 + 129) % 256
);

/** 捕获 console.warn（回落告警断言用，finally 恢复）。 */
function captureWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

describe("zlib 加速器（W1-P1-4）", () => {
  it("交叉兼容：node:zlib 产物 fflate 可解、fflate 产物 node 可解、逐字节等值", () => {
    for (const plain of [TEXT_PLAIN, EMPTY_PLAIN, BINARY_PLAIN]) {
      const byNode = new Uint8Array(deflateSync(plain));
      assert.deepEqual(
        unzlibSync(byNode),
        plain,
        "node:zlib deflate 产物 fflate unzlibSync 应解出逐字节等值明文"
      );

      const byFflate = zlibSync(plain);
      assert.deepEqual(
        new Uint8Array(inflateSync(byFflate)),
        plain,
        "fflate 产物 node:zlib inflateSync 应解出逐字节等值明文"
      );
    }
  });

  it("注册后：zlib-codec 往返真走加速器（spy 计数）且等值；fossil 数据也能读", () => {
    // 先用 fflate 造一份「未注册期产物」（如旧库/RN 写的数据）。
    const fflateCompressed = zlibSync(TEXT_PLAIN);

    const spy = countingNodeAccelerator();
    registerZlibCodecAccelerator(spy.accel);

    const roundTrips = [TEXT_PLAIN, EMPTY_PLAIN, BINARY_PLAIN];
    for (const plain of roundTrips) {
      const compressed = compressZlib(plain);
      assert.deepEqual(
        new Uint8Array(decompressZlib(compressed)),
        plain,
        "注册后 compress/decompress 往返应等值"
      );
    }
    // 注册后读 fflate 产物（跨实现读兼容）。
    assert.deepEqual(new Uint8Array(decompressZlib(fflateCompressed)), TEXT_PLAIN);

    // level 透传面（pbp-17）：compressZlib 目前恒不传 level，但契约上的
    // level 一旦被透传，宿主适配器的三元分支必须能安全交给 node:zlib。
    // 有加速器时直接断言产物可被 fflate 解回等值明文。
    const levelNine = tryZlibDeflate(TEXT_PLAIN, 9);
    assert.ok(levelNine != null, "注册后带 level 调用应走加速器");
    assert.deepEqual(
      unzlibSync(levelNine),
      TEXT_PLAIN,
      "level=9 产物 fflate unzlibSync 应解出逐字节等值明文"
    );

    // 无加速器时同一调用回落（返回 null），调用方按 fflate 走，同样不炸。
    clearZlibCodecAccelerator();
    assert.equal(tryZlibDeflate(TEXT_PLAIN, 9), null);
    assert.deepEqual(
      new Uint8Array(compressZlib(TEXT_PLAIN)),
      new Uint8Array(zlibSync(TEXT_PLAIN)),
      "注销后带 level 的调用回落 fflate，产物应与 fflate 逐字节一致"
    );
    registerZlibCodecAccelerator(spy.accel);

    const counts = spy.counts();
    assert.ok(counts.deflates >= roundTrips.length, "compressZlib 应调加速器 deflate");
    assert.ok(counts.inflates >= roundTrips.length + 1, "decompressZlib 应调加速器 inflate");
  });

  it("注册后：pack-codec 两 format 编解码往返等值且走加速器", () => {
    const spy = countingNodeAccelerator();
    registerZlibCodecAccelerator(spy.accel);
    const members = [
      encoder.encode("版本一：" + "山雨欲来风满楼。".repeat(400)),
      encoder.encode("版本二：" + "山雨欲来风满楼。".repeat(400) + "尾段"),
      BINARY_PLAIN,
    ];

    const concat = encodeZlibConcatPack(members);
    const concatPlain = decodeZlibConcatSpans(concat.bytes, concat.spans);
    concatPlain.forEach((plain, index) => {
      assert.deepEqual(plain, members[index], `zlib-concat 成员 ${index} 往返等值`);
    });

    const fossil = encodeFossilChainPack(members);
    const fossilPlain = decodeFossilChainSpans(fossil.bytes, fossil.spans);
    fossilPlain.forEach((plain, index) => {
      assert.deepEqual(plain, members[index], `fossil-chain 成员 ${index} 往返等值`);
    });

    const counts = spy.counts();
    // 两 format 编码：concat 1 段 + fossil 3 段 = 4 次 deflate；解码：concat 1 + fossil 3 = 4 次 inflate。
    assert.ok(counts.deflates >= 4, `pack 编码应走加速器 deflate（实际 ${counts.deflates}）`);
    assert.ok(counts.inflates >= 4, `pack 解码应走加速器 inflate（实际 ${counts.inflates}）`);
  });

  it("注销即复位告警闩锁：再次注册后同一方向的抛错仍会告警（pbp-18）", () => {
    const throwing = (tag: string): ZlibCodecAccelerator => ({
      deflate: () => {
        throw new Error(`deflate boom ${tag}`);
      },
      inflate: () => {
        throw new Error(`inflate boom ${tag}`);
      },
    });

    // 第一段：注册抛错加速器，触发一次 deflate / inflate 抛错把闩锁打上。
    const first = captureWarnings(() => {
      registerZlibCodecAccelerator(throwing("#1"));
      compressZlib(TEXT_PLAIN);
      decompressZlib(zlibSync(TEXT_PLAIN));
    });
    assert.ok(
      first.warnings.some((line) => line.includes("deflate 加速器抛错")),
      "首次抛错应告警"
    );
    assert.ok(
      first.warnings.some((line) => line.includes("inflate 加速器抛错")),
      "首次抛错应告警"
    );

    // 注销：闩锁按注册期计，应随之复位（回到从未注册的状态）。
    clearZlibCodecAccelerator();

    // 第二段：同形态抛错再来一次，告警必须再次出现——若闩锁没随注销复位，
    // 这里会被静默吞掉（后续注册的加速器再也报不出错，生产上无从发现）。
    const second = captureWarnings(() => {
      registerZlibCodecAccelerator(throwing("#2"));
      compressZlib(TEXT_PLAIN);
      decompressZlib(zlibSync(TEXT_PLAIN));
    });
    assert.ok(
      second.warnings.some((line) => line.includes("deflate 加速器抛错")),
      "注销后重新注册，deflate 抛错应再次告警（闩锁须随注销复位）"
    );
    assert.ok(
      second.warnings.some((line) => line.includes("inflate 加速器抛错")),
      "注销后重新注册，inflate 抛错应再次告警（闩锁须随注销复位）"
    );
  });

  it("加速器抛错 / 返回 null 一律回落 fflate（产物与 fflate 逐字节一致）", () => {
    const { result, warnings } = captureWarnings(() => {
      const throwing: ZlibCodecAccelerator = {
        deflate: () => {
          throw new Error("deflate boom");
        },
        inflate: () => {
          throw new Error("inflate boom");
        },
      };
      registerZlibCodecAccelerator(throwing);
      const compressed = compressZlib(TEXT_PLAIN);
      const decompressed = decompressZlib(compressed);
      return { compressed, decompressed };
    });
    assert.deepEqual(
      new Uint8Array(result.compressed),
      new Uint8Array(zlibSync(TEXT_PLAIN)),
      "抛错回落后的压缩产物应与 fflate 逐字节一致"
    );
    assert.deepEqual(result.decompressed, TEXT_PLAIN);
    assert.ok(
      warnings.some((line) => line.includes("deflate 加速器抛错")),
      "deflate 回落应告警一次"
    );
    assert.ok(
      warnings.some((line) => line.includes("inflate 加速器抛错")),
      "inflate 回落应告警一次"
    );

    const nullish = captureWarnings(() => {
      registerZlibCodecAccelerator({
        deflate: () => null,
        inflate: () => null,
      });
      return {
        compressed: compressZlib(TEXT_PLAIN),
        decompressed: decompressZlib(zlibSync(TEXT_PLAIN)),
      };
    });
    assert.deepEqual(
      new Uint8Array(nullish.result.compressed),
      new Uint8Array(zlibSync(TEXT_PLAIN)),
      "返回 null 回落后的压缩产物应与 fflate 逐字节一致"
    );
    assert.deepEqual(nullish.result.decompressed, TEXT_PLAIN);
  });

  it("未注册时行为与历史一致（try* 返回 null、产物与 fflate 逐字节一致）", () => {
    clearZlibCodecAccelerator();
    assert.equal(tryZlibDeflate(TEXT_PLAIN), null);
    assert.equal(tryZlibInflate(TEXT_PLAIN), null);
    assert.deepEqual(
      new Uint8Array(compressZlib(TEXT_PLAIN)),
      new Uint8Array(zlibSync(TEXT_PLAIN))
    );
    assert.deepEqual(decompressZlib(zlibSync(TEXT_PLAIN)), TEXT_PLAIN);

    // 注销后注册态彻底消失（再次 try* 仍为 null）。
    registerZlibCodecAccelerator(NODE_ACCELERATOR);
    assert.ok(tryZlibDeflate(TEXT_PLAIN) != null);
    clearZlibCodecAccelerator();
    assert.equal(tryZlibDeflate(TEXT_PLAIN), null);
  });
});
