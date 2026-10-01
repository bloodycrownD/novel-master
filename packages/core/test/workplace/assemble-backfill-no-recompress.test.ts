/**
 * 免重压缩优化的 spy 级回归（2026-09-30 workplace 冷路径优化配套）。
 *
 * 病根修复把「压缩 + 落库」挪到了后台，但**不能顺手把昨天的
 * 「先 hash 比对、blob 已在库则不压缩」优化改丢**。DB 层观测（blob 行数
 * 不增长）区分不了「压缩被跳过」与「压缩后被 INSERT OR IGNORE 丢弃」，
 * 所以这里用 `mock.module` 把 `compressFileCacheBodyForBlob` 换成计数
 * spy，直接钉死调用次数。
 *
 * 独立成文件的必要性（module mock 需先于被测模块注册，同
 * message-content-decompression.test.ts 的坏行桩范式）：
 * `mock.module` 必须在被测模块被 import 之前注册，静态 import 会被提升到
 * mock 之前拿到的就不是桩。
 *
 * @module test/workplace/assemble-backfill-no-recompress
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

// 1) 先拿真实 codec 引用（mock 注册前的模块缓存，供透传）。
const realCodec = await import("../../src/domain/session-kkv/logic/file-cache-blob-codec.js");

let compressCalls = 0;
let hashCalls = 0;

// 2) 注册 spy（namedExports 必须补齐全，否则其它导出是 undefined）。
mock.module("../../src/domain/session-kkv/logic/file-cache-blob-codec.js", {
  namedExports: {
    hashFileCachePayload: (value: string) => {
      hashCalls++;
      return realCodec.hashFileCachePayload(value);
    },
    compressFileCacheBodyForBlob: (body: string) => {
      compressCalls++;
      return realCodec.compressFileCacheBodyForBlob(body);
    },
    decodeFileCacheBlobBody: realCodec.decodeFileCacheBlobBody,
  },
});

// 3) mock 之后再动态 import 被测链路（顺序不可换）。
const { createSessionKkvService } = await import(
  "../../src/service/session-kkv/create-session-kkv-service.js"
);
const { SESSION_KKV_DOMAIN_FILE_CACHE } = await import(
  "../../src/domain/session-kkv/model/session-kkv-domains.js"
);
const { serializeFileCachePayload } = await import(
  "../../src/domain/workplace/logic/rule-snapshot-codec.js"
);
const {
  assembleWorkplaceDisplay,
} = await import("../../src/service/workplace/assemble-workplace-display.js");
const { createWorkplaceService } = await import(
  "../../src/service/workplace/create-workplace-service.js"
);
const { settlePendingFileCacheBackfills } = await import(
  "../../src/domain/workplace/logic/load-or-fill-file-cache.js"
);
const { openNovelMasterTestConnection } = await import("../helpers/novel-master.js");

describe("file_cache 免重压缩（后台化后仍生效）", () => {
  it("T-BF3b blob 已在库：set 侧 hash 比对命中，不再调用压缩", async () => {
    const ctx = await openNovelMasterTestConnection();
    try {
      const sk = createSessionKkvService(ctx.conn);
      const sid = `bf3b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const value = serializeFileCachePayload({ body: `bf3b-body-${sid}`, mtimeMs: 1 });

      await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/bf3b.md", value);
      assert.equal(compressCalls, 1, "blob 不存在时必须真压缩一次");
      assert.ok(hashCalls >= 1, "hash 比对必须被调用");

      // blob 已在库（clearDomain 只删引用行，blob 内容寻址全库共享）
      await sk.clearDomain(sid, SESSION_KKV_DOMAIN_FILE_CACHE);
      const before = compressCalls;
      await sk.set(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/bf3b.md", value);

      assert.equal(
        compressCalls,
        before,
        "blob 已存在时不得再压缩（免重压缩优化在后台化后仍生效）"
      );
      assert.equal(
        await sk.get(sid, SESSION_KKV_DOMAIN_FILE_CACHE, "full:/bf3b.md"),
        value,
        "免压缩路径仍要逐字节还原"
      );
    } finally {
      await ctx.conn.close();
    }
  });

  it("T-BF3c 组装侧：清域后二次 assemble 走后台回填，blob 同 hash 不再压缩", async () => {
    const ctx = await openNovelMasterTestConnection();
    try {
      const project = await ctx.projects.create(`P-bf3c-${Date.now()}`);
      const session = await ctx.sessions.create(project.id);
      const sk = createSessionKkvService(ctx.conn);
      const vfs = ctx.sessionVfs(project.id, session.id);
      const body = `bf3c-unique-${Math.random().toString(36).slice(2, 10)}`;
      await vfs.write("/bf3c.md", body);
      const wt = createWorkplaceService(ctx.conn, {
        kind: "session",
        projectId: project.id,
        sessionId: session.id,
      });
      await wt.setFileRule({ logicalPath: "/bf3c.md", inclusionMode: "show" });
      const scope = { kind: "session" as const, projectId: project.id, sessionId: session.id };
      const deps = { sessionKkv: sk, workplace: wt, vfs, layout: { workplace: "【done】" } };

      // 第一次：blob 不存在 → 真压缩
      const out1 = await assembleWorkplaceDisplay(scope, deps);
      assert.match(out1.workplaceDisplay, /bf3c-unique-/);
      await settlePendingFileCacheBackfills();
      const afterFirst = compressCalls;
      assert.ok(afterFirst > 0, "首次回填必须真压缩");

      // 清 file_cache 引用行（blob 保留）→ 二次 assemble 仍 miss，
      // 读 VFS 后台回填；此时 blob 已在库 → 免压缩
      await sk.clearDomain(session.id, SESSION_KKV_DOMAIN_FILE_CACHE);
      const out2 = await assembleWorkplaceDisplay(scope, deps);
      assert.match(out2.workplaceDisplay, /bf3c-unique-/, "二次组装仍出正文（自愈重读）");
      await settlePendingFileCacheBackfills();

      assert.equal(
        compressCalls,
        afterFirst,
        "blob 已在库时后台回填不得再压缩（免重压缩优化没被后台化改丢）"
      );
    } finally {
      await ctx.conn.close();
    }
  });
});
