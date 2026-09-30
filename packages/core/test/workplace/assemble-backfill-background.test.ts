/**
 * workplace 冷 miss 回填写回时序（2026-09-30 冷路径优化）。
 *
 * 病根：冷态 assemble 4780ms 里 77% 花在「压缩 + 落库 file_cache」上
 * （纯读只占 23%），而缓存只是加速层——读侧要的正文已经在手里。本文件
 * 钉死改后契约：
 *
 * - T-BF1 冷 miss：组装结果立即含正文，不等缓存写完（写侧被闸门挂住也返回）
 * - T-BF2 后台写最终落定，缓存可查（回填没被丢掉）
 * - T-BF3 已有缓存行且 hash 一致时不再压缩（昨天的「先 hash 比对」优化
 *   没被改丢）——用 spy 数 compressFileCacheBodyForBlob 调用次数
 * - T-BF4 后台写失败静默：无 unhandled rejection，组装照常返回
 * - T-BF5 hydrate 语义不变：loadOrFillFileCache 默认仍同步落库
 *
 * T-BF1/T-BF4 需要「写侧被挂住仍能返回」，用内存 kkv 的 set 闸门表达。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionKkvService } from "../../src/service/session-kkv/session-kkv.port.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
  fileCacheKey,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import {
  loadOrFillFileCache,
  settlePendingFileCacheBackfills,
} from "../../src/domain/workplace/logic/load-or-fill-file-cache.js";
import { parseFileCachePayload } from "../../src/domain/workplace/logic/rule-snapshot-codec.js";
import { hashContent } from "../../src/domain/vfs/content-store/logic/hash-content.js";
import type { VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { createWorkplaceService } from "../../src/service/workplace/create-workplace-service.js";
import { assembleWorkplaceDisplay } from "../../src/service/workplace/assemble-workplace-display.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

const LAYOUT: Pick<AgentPromptLayout, "workplace"> = { workplace: "【done】" };

/** 未超限的轻量 vfs fake：findContentSize 走 inlineChars 正常值。 */
function fakeVfs(content: string): VfsService {
  return {
    async read() {
      return {
        path: "/note.md",
        content,
        version: 1,
        mtimeMs: 1_700_000_000_000,
      };
    },
    async findContentSize() {
      return {
        kind: "inlineChars" as const,
        size: content.length,
        mtimeMs: 1_700_000_000_000,
      };
    },
  } as unknown as VfsService;
}

/**
 * 在内存/真实 kkv 外面套一层「file_cache 域 set 闸门」：该域的 set 先挂住
 * 不 resolve，用于表达「写侧还在跑，读侧已经能返回」。
 *
 * 只闸 `file_cache` 域：assemble 里的 `rule_snapshot` 写入仍是同步 await
 * 的（不在本次优化范围），一并挂死会让用例挂在优化之外的地方。
 */
function gatedKkv(
  inner: SessionKkvService
): SessionKkvService & { releaseSets: () => void; setCalls: () => number } {
  const gates: (() => void)[] = [];
  let setCount = 0;
  const wrapped: SessionKkvService = {
    get: (s, d, k) => inner.get(s, d, k),
    getMany: (s, d, ks) => inner.getMany(s, d, ks),
    set: async (s, d, k, v) => {
      if (d !== SESSION_KKV_DOMAIN_FILE_CACHE) {
        await inner.set(s, d, k, v);
        return;
      }
      setCount++;
      await new Promise<void>((resolve) => gates.push(resolve));
      await inner.set(s, d, k, v);
    },
    delete: (s, d, k) => inner.delete(s, d, k),
    clearDomain: (s, d) => inner.clearDomain(s, d),
    clearSession: (s) => inner.clearSession(s),
    listKeys: (s, d) => inner.listKeys(s, d),
  };
  return Object.assign(wrapped, {
    releaseSets: () => {
      while (gates.length > 0) {
        gates.shift()!();
      }
    },
    setCalls: () => setCount,
  });
}

/** 让出足够多的宏任务，等后台回填（推迟一个宏任务）真正被调度起来。 */
async function flushMacrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("workplace 冷 miss 回填后台化", () => {
  it("T-BF1 冷 miss：组装结果立即含正文，缓存写侧被闸门挂住也照样返回", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const inner = createSessionKkvService(ctx.conn);
    const gated = gatedKkv(inner);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/cold.md", "冷态正文ABC");
    const wt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await wt.setFileRule({ logicalPath: "/cold.md", inclusionMode: "show" });

    try {
      // 写侧被闸门挂死：file_cache 域的 kkv.set 永不 resolve。改后 assemble
      // 既不 await 它、也不等它被调度，所以这一行必须返回；若实现仍同步
      // await set，本用例会挂在闸门上（event loop 空转 → cancelled）而红。
      const out = await assembleWorkplaceDisplay(
        { kind: "session", projectId: project.id, sessionId: session.id },
        { sessionKkv: gated, workplace: wt, vfs, layout: LAYOUT }
      );

      assert.match(out.workplaceDisplay, /冷态正文ABC/);
      assert.deepEqual(out.prefixPaths, ["/cold.md"]);
      assert.equal(
        await inner.get(
          session.id,
          SESSION_KKV_DOMAIN_FILE_CACHE,
          fileCacheKey("full", "/cold.md")
        ),
        null,
        "assemble 返回时缓存写还没落库——正文不靠缓存交到读者手里"
      );

      // 让一个宏任务过去：后台回填此时才被调度起来（写侧推迟到宏任务是
      // 为了不跟同轮 vfs.read 抢 JS 线程），随后被闸门挂住不落库。
      await flushMacrotasks();
      assert.equal(gated.setCalls(), 1, "后台回填确实被发起了（只是没等它）");
      assert.equal(
        await inner.get(
          session.id,
          SESSION_KKV_DOMAIN_FILE_CACHE,
          fileCacheKey("full", "/cold.md")
        ),
        null,
        "写侧挂起期间缓存仍查不到"
      );
    } finally {
      // 收尾必须无条件执行：闸门不放行的话 pending 集合里的 promise 永不
      // 落定，后续用例的 settlePendingFileCacheBackfills 会一起挂死。
      gated.releaseSets();
      await settlePendingFileCacheBackfills();
    }
  });

  it("T-BF2 缓存最终被回填：后台写落定后 kkv 可查到同一份正文", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/fill.md", "后台回填正文XYZ");
    const wt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await wt.setFileRule({ logicalPath: "/fill.md", inclusionMode: "show" });

    const out = await assembleWorkplaceDisplay(
      { kind: "session", projectId: project.id, sessionId: session.id },
      { sessionKkv: sk, workplace: wt, vfs, layout: LAYOUT }
    );
    assert.match(out.workplaceDisplay, /后台回填正文XYZ/);

    // 后台写的可观测闸门：settle 后缓存必须已经落库。
    // 若实现把回填直接丢掉（只返回不写），这里必然 null → 红。
    await settlePendingFileCacheBackfills();
    const raw = await sk.get(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
      fileCacheKey("full", "/fill.md")
    );
    assert.notEqual(raw, null, "后台回填必须最终落库");
    const payload = parseFileCachePayload(raw!);
    assert.equal(payload!.body, "后台回填正文XYZ");
  });

  it("T-BF3 已有缓存行且 blob 同 hash：不再压缩（昨天的免重压缩优化未被改丢）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const body = `同内容不回填-${testIsolationSuffix()}`;
    await vfs.write("/same.md", body);
    const wt = createWorkplaceService(ctx.conn, {
      kind: "session",
      projectId: project.id,
      sessionId: session.id,
    });
    await wt.setFileRule({ logicalPath: "/same.md", inclusionMode: "show" });
    const scope = { kind: "session" as const, projectId: project.id, sessionId: session.id };
    const deps = { sessionKkv: sk, workplace: wt, vfs, layout: LAYOUT };
    // body 带 testIsolationSuffix 唯一 → 按 hash 计数与「本用例只落 1 行」等价
    // （夹具内存库由本文件所有用例共享，全表 COUNT(*) 不可用）
    const blobCountFor = async (): Promise<number> => {
      const rows = await ctx.conn.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM session_file_cache_blob WHERE content_hash = ?",
        [hashContent(body)]
      );
      return Number(rows[0]!.n);
    };

    // 第一次：blob 尚不存在，必然真压缩一次，压缩后 blob 落库。
    await assembleWorkplaceDisplay(scope, deps);
    await settlePendingFileCacheBackfills();
    assert.equal(await blobCountFor(), 1, "首次回填落 1 行 blob");

    // 清 file_cache 引用行（blob 保留）模拟「置位/压缩后清域、内容未变」：
    // 下一次 assemble 仍会 miss → 读 VFS → 回填，但 blob 已存在。
    // 契约：set 侧的「先 hash 比对、命中即免压缩」必须仍然生效。
    await sk.clearDomain(session.id, SESSION_KKV_DOMAIN_FILE_CACHE);
    const out = await assembleWorkplaceDisplay(scope, deps);
    assert.ok(out.workplaceDisplay.includes(body), "二次组装仍出正文（自愈重读）");
    await settlePendingFileCacheBackfills();

    assert.equal(
      await blobCountFor(),
      1,
      "同内容二次回填未产生新 blob 行（免重压缩在 DB 层的可观测形态）"
    );
    // 注：DB 层区分不了「压缩被跳过」与「压缩后被 INSERT OR IGNORE 丢弃」，
    // 钉死调用次数的强判据在 assemble-backfill-no-recompress.test.ts
    // （mock.module spy）。
  });

  it("T-BF3b 免重压缩（spy 级）见独立文件 assemble-backfill-no-recompress.test.ts", () => {
    // mock.module 必须在被测模块 import 之前注册，而本文件已静态 import
    // 了 create-session-kkv-service（→ sqlite repository → blob codec），
    // 同文件内再 mock 已经太晚。故独立成文件。
    assert.ok(true);
  });

  it("T-BF4 后台写失败静默：kkv.set 抛错不冒泡、无 unhandled rejection", async () => {
    const inner = createMemoryLikeKkv();
    const boom = new Error("模拟后台写失败");
    const vfs = fakeVfs("失败静默正文");
    const deps = {
      sessionId: "bf4",
      sessionKkv: {
        get: inner.get,
        getMany: inner.getMany,
        set: () => Promise.reject(boom),
        delete: inner.delete,
        clearDomain: inner.clearDomain,
        clearSession: inner.clearSession,
        listKeys: inner.listKeys,
      } as unknown as SessionKkvService,
      vfs,
      path: "/note.md",
      status: "full" as const,
    };

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      // deferBackfillWrite: set 必抛——返回仍须是正文，不能冒泡
      const { fillFileCacheFromVfs } = await import(
        "../../src/domain/workplace/logic/load-or-fill-file-cache.js"
      );
      const payload = await fillFileCacheFromVfs(deps, { deferBackfillWrite: true });
      assert.equal(payload.body, "失败静默正文");
      await settlePendingFileCacheBackfills();
      // 让 unhandledRejection 的检测窗口过去（Node 默认在微任务轮后派发）
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    assert.deepEqual(
      unhandled.filter((r) => r === boom),
      [],
      "后台写 rejection 必须被吞掉，不留 unhandledRejection"
    );
  });

  it("T-BF6 回填推迟到宏任务：assemble 返回那一刻写侧还没被调度", async () => {
    // fflate 的 zlibSync 是同步 CPU 工作，直接 void write() 虽不 await，
    // 仍会跟同轮 vfs.read 抢 JS 线程（实测 375ms vs 推迟后 128ms）。
    // 本用例钉死「推迟一个宏任务」这个时序：assemble resolve 的同一轮
    // 微任务里，write 一次都没被调用过。
    const inner = createMemoryLikeKkv();
    let setCalls = 0;
    const kkv: SessionKkvService = {
      ...inner,
      set: async (s, d, k, v) => {
        setCalls++;
        await inner.set(s, d, k, v);
      },
    };
    const { fillFileCacheFromVfs } = await import(
      "../../src/domain/workplace/logic/load-or-fill-file-cache.js"
    );
    const payload = await fillFileCacheFromVfs(
      {
        sessionId: "bf6",
        sessionKkv: kkv,
        vfs: fakeVfs("宏任务推迟正文"),
        path: "/note.md",
        status: "full",
      },
      { deferBackfillWrite: true }
    );

    assert.equal(payload.body, "宏任务推迟正文", "读侧结果不受调度时机影响");
    assert.equal(
      setCalls,
      0,
      "assemble/fill 返回的同一轮里后台写尚未被调度（必须推迟到宏任务）"
    );

    await settlePendingFileCacheBackfills();
    assert.equal(setCalls, 1, "宏任务过后后台写被调度一次");
    assert.equal(
      parseFileCachePayload(
        (await inner.get("bf6", SESSION_KKV_DOMAIN_FILE_CACHE, "full:/note.md"))!
      )!.body,
      "宏任务推迟正文"
    );
  });

  it("T-BF5 hydrate 语义不变：loadOrFillFileCache 默认同步落库（返回即可查）", async () => {
    const inner = createMemoryLikeKkv();
    const payload = await loadOrFillFileCache({
      sessionId: "bf5",
      sessionKkv: inner,
      vfs: fakeVfs("同步落库正文"),
      path: "/note.md",
      status: "full",
    });
    assert.equal(payload.body, "同步落库正文");
    // 未加 defer 选项：await 返回时缓存必须已经在（不改 hydrate 语义）
    const raw = await inner.get("bf5", SESSION_KKV_DOMAIN_FILE_CACHE, "full:/note.md");
    assert.notEqual(raw, null, "默认路径仍同步写回 file_cache");
    assert.equal(parseFileCachePayload(raw!)!.body, "同步落库正文");
  });
});

/** 内存 kkv（自带计数不必要，与门控 kkv 配套使用）。 */
function createMemoryLikeKkv(): SessionKkvService {
  const map = new Map<string, string>();
  const slot = (s: string, d: string, k: string) => `${s}\0${d}\0${k}`;
  return {
    async get(s, d, k) {
      return map.get(slot(s, d, k)) ?? null;
    },
    async getMany(s, d, ks) {
      const out = new Map<string, string>();
      for (const k of ks) {
        const v = map.get(slot(s, d, k));
        if (v != null) {
          out.set(k, v);
        }
      }
      return out;
    },
    async set(s, d, k, v) {
      map.set(slot(s, d, k), v);
    },
    async delete(s, d, k) {
      map.delete(slot(s, d, k));
    },
    async clearDomain(s, d) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${s}\0${d}\0`)) {
          map.delete(key);
        }
      }
    },
    async clearSession(s) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${s}\0`)) {
          map.delete(key);
        }
      }
    },
    async listKeys(s, d) {
      const prefix = `${s}\0${d}\0`;
      return [...map.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    },
  };
}
