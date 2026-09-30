/**
 * assembleWorkplaceDisplay 的按文件粒度中止 + 内容指纹（2026-09-30
 * 「停止要等 14 秒」与「切会话重算」治本点的回归锁）。
 *
 * - shouldStop：快照加载后 + 每个文件的缓存解析/VFS 回填之前检查，真值抛
 *   WorkplaceAssemblyAbortedError。观测面用 vfs.read 调用次数——「下一个
 *   文件不再读」是中止真正生效的直接证据。
 * - fingerprint：path|status|mtimeMs 列表 join。同输入同指纹；任一文件的
 *   mtime 变了指纹必须变（这是下游估算记忆「内容没变」判定的全部依据）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import { createWorkplaceService } from "../../src/service/workplace/create-workplace-service.js";
import {
  assembleWorkplaceDisplay,
  WorkplaceAssemblyAbortedError,
} from "../../src/service/workplace/assemble-workplace-display.js";
import {
  SESSION_KKV_DOMAIN_FILE_CACHE,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { settlePendingFileCacheBackfills } from "../../src/domain/workplace/logic/load-or-fill-file-cache.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { AgentPromptLayout } from "../../src/domain/prompt/model/agent-prompt-layout.js";
import type { VfsService } from "../../src/domain/vfs/ports/vfs-service.port.js";

novelMasterTestFixture();

function layoutWithWorkplace(): Pick<AgentPromptLayout, "workplace"> {
  return { workplace: "【done】" };
}

/** 数 vfs.read 次数的包装（其余方法原样转发）。 */
function countingVfs(vfs: VfsService): {vfs: VfsService; readCalls: () => number} {
  let reads = 0;
  const wrapped = new Proxy(vfs, {
    get(target, prop, receiver) {
      if (prop === "read") {
        return async (...args: Parameters<VfsService["read"]>) => {
          reads += 1;
          return target.read(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as VfsService;
  return {vfs: wrapped, readCalls: () => reads};
}

async function seedTwoFiles() {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id);
  const sk = createSessionKkvService(ctx.conn);
  const realVfs = ctx.sessionVfs(project.id, session.id);
  await realVfs.write("/a.md", "正文甲".repeat(50));
  await realVfs.write("/b.md", "正文乙".repeat(50));
  const wt = createWorkplaceService(ctx.conn, {
    kind: "session",
    projectId: project.id,
    sessionId: session.id,
  });
  await wt.setFileRule({ logicalPath: "/a.md", inclusionMode: "show" });
  await wt.setFileRule({ logicalPath: "/b.md", inclusionMode: "show" });
  // 预热快照 + file_cache：让后续 assemble 走「缓存命中」路径（中止用例要
  // 的是检查点行为，不是回填 IO 的快慢）。
  await assembleWorkplaceDisplay(
    { kind: "session", projectId: project.id, sessionId: session.id },
    { sessionKkv: sk, workplace: wt, vfs: realVfs, layout: layoutWithWorkplace() },
  );
  const scope = {
    kind: "session" as const,
    projectId: project.id,
    sessionId: session.id,
  };
  // 预热 assemble 的后台回填（deferBackfillWrite）落定后再交还——否则调用方
  // 紧接着的 clearDomain 可能被迟到的回填复活，逼不出逐文件重读。
  await settlePendingFileCacheBackfills();
  return {ctx, scope, sk, wt, realVfs};
}

describe("assembleWorkplaceDisplay：按文件粒度中止（2026-09-30 治本）", () => {
  it("快照加载后即命中 → 抛中止错误，一个文件都不读", async () => {
    const {scope, sk, wt, realVfs} = await seedTwoFiles();
    const {vfs, readCalls} = countingVfs(realVfs);
    await assert.rejects(
      () =>
        assembleWorkplaceDisplay(
          scope,
          {sessionKkv: sk, workplace: wt, vfs, layout: layoutWithWorkplace()},
          {shouldStop: () => true},
        ),
      (error: unknown) => error instanceof WorkplaceAssemblyAbortedError,
      "shouldStop 为真必须抛 WorkplaceAssemblyAbortedError",
    );
    assert.equal(readCalls(), 0, "快照后命中 → 连第一个文件都不该读");
  });

  it("第一个文件读完翻真 → 抛中止错误，第二个文件不再读（文件粒度兑现）", async () => {
    const {scope, sk, wt, realVfs} = await seedTwoFiles();
    // 清 file_cache 逼出逐文件回填（回填才读 VFS）——「文件之间」的窗口
    // 只有在逐文件读时才可观测。
    await sk.clearDomain(scope.sessionId, SESSION_KKV_DOMAIN_FILE_CACHE);
    const {vfs, readCalls} = countingVfs(realVfs);
    await assert.rejects(
      () =>
        assembleWorkplaceDisplay(
          scope,
          {sessionKkv: sk, workplace: wt, vfs, layout: layoutWithWorkplace()},
          {shouldStop: () => readCalls() >= 1},
        ),
      (error: unknown) => error instanceof WorkplaceAssemblyAbortedError,
    );
    assert.equal(
      readCalls(),
      1,
      "第一个文件回填后翻真 → 第二个文件的 read 不该发生（文件粒度检查点）",
    );
  });

  it("不传 shouldStop → 行为与原来一致（含 fingerprint 产出）", async () => {
    const {scope, sk, wt, realVfs} = await seedTwoFiles();
    const out = await assembleWorkplaceDisplay(scope, {
      sessionKkv: sk,
      workplace: wt,
      vfs: realVfs,
      layout: layoutWithWorkplace(),
    });
    assert.ok(out.workplaceDisplay.length > 0);
    assert.ok(out.fingerprint.length > 0, "正常路径必须产出指纹");
  });
});

describe("assembleWorkplaceDisplay：内容指纹", () => {
  it("同输入两次组装指纹逐字符相同；文件 mtime 变化指纹必变", async () => {
    const {scope, sk, wt, realVfs} = await seedTwoFiles();
    const first = await assembleWorkplaceDisplay(scope, {
      sessionKkv: sk,
      workplace: wt,
      vfs: realVfs,
      layout: layoutWithWorkplace(),
    });
    // 触碰 a.md（重写内容 → mtime 前进）。mtime 毫秒粒度：循环写入直到 mtime
    // 真的变化（同毫秒内重写不前进）。
    const mtimeBefore = (await realVfs.read("/a.md")).mtimeMs;
    let mtimeAdvanced = false;
    for (let i = 0; i < 60 && !mtimeAdvanced; i++) {
      await realVfs.write("/a.md", `正文甲改${i}`.repeat(50));
      mtimeAdvanced = (await realVfs.read("/a.md")).mtimeMs !== mtimeBefore;
    }
    assert.ok(mtimeAdvanced, "前提不成立：60 次重写都没让 mtime 前进（无法验证敏感性）");
    // 快照的 path/status 没变，mtime 变了 → 清缓存逼出重读后指纹必须不同
    // （缓存未失效的窗口里指纹用缓存内旧 mtime 是既有 file_cache 语义，写
    // 路径负责失效；本用例只锁「指纹对真实输入敏感」）。
    await sk.clearDomain(scope.sessionId, SESSION_KKV_DOMAIN_FILE_CACHE);
    const second = await assembleWorkplaceDisplay(scope, {
      sessionKkv: sk,
      workplace: wt,
      vfs: realVfs,
      layout: layoutWithWorkplace(),
    });
    assert.notEqual(
      first.fingerprint,
      second.fingerprint,
      "文件内容/mtime 变了指纹必须变（估算记忆的失效依据）",
    );
    // 稳定性：再组装一次（缓存已暖）指纹不变。
    const third = await assembleWorkplaceDisplay(scope, {
      sessionKkv: sk,
      workplace: wt,
      vfs: realVfs,
      layout: layoutWithWorkplace(),
    });
    assert.equal(second.fingerprint, third.fingerprint);
  });
});
