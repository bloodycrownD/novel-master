/**
 * ensureImportDirRules 单测：scope 键空间正确性、根路径跳过、空差集零写入、
 * 吞错路径，以及补入行与 setDirRule 产物的逐字段等价性。
 *
 * 键空间 / 差集 / 吞错用内存 stub（不依赖真实 DB）；等价性用例走
 * novelMasterTestFixture 对照真实 WorkplaceService.setDirRule 产物。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VfsEntryRepository } from "../../../src/domain/vfs/repositories/vfs-entry.port.js";
import type { WorkplaceDirRule } from "../../../src/domain/workplace/model/workplace-types.js";
import type { WorkplaceRepository } from "../../../src/domain/workplace/repositories/workplace.port.js";
import { SqliteVfsEntryRepository } from "../../../src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.js";
import { SqliteWorkplaceRepository } from "../../../src/domain/workplace/repositories/impl/sqlite-workplace.repository.js";
import {
  buildDefaultDirRule,
  ensureImportDirRules,
} from "../../../src/service/vfs/logic/ensure-import-dir-rules.js";
import { createWorkplaceService } from "@novel-master/core/workplace";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 最小 stub：记录调用参数，可注入返回值 / 抛错。 */
function makeStubs(options?: {
  directories?: string[];
  existingRules?: WorkplaceDirRule[];
  listDirRulesError?: Error;
  upsertError?: Error;
}) {
  const calls = {
    vfsPrefix: [] as Array<{ scopeKey: string; prefix: string }>,
    listDirRulesScopeKeys: [] as string[],
    upserted: [] as WorkplaceDirRule[],
  };
  const vfsRepo = {
    listDirectoryPathsUnderPrefix: async (scopeKey: string, prefix: string) => {
      calls.vfsPrefix.push({ scopeKey, prefix });
      return options?.directories ?? [];
    },
  } as unknown as VfsEntryRepository;
  const workplaceRepo = {
    listDirRules: async (scopeKey: string) => {
      calls.listDirRulesScopeKeys.push(scopeKey);
      if (options?.listDirRulesError) {
        throw options.listDirRulesError;
      }
      return options?.existingRules ?? [];
    },
    upsertDirRule: async (rule: WorkplaceDirRule) => {
      if (options?.upsertError) {
        throw options.upsertError;
      }
      calls.upserted.push(rule);
    },
  } as unknown as WorkplaceRepository;
  return { vfsRepo, workplaceRepo, calls };
}

const SESSION_SCOPE = {
  kind: "session" as const,
  projectId: "p1",
  sessionId: "s1",
};

describe("ensureImportDirRules（stub 单测）", () => {
  it("T-I6: 根路径 / 跳过——零查询零写入", async () => {
    const { vfsRepo, workplaceRepo, calls } = makeStubs({
      directories: ["/a"],
    });
    await ensureImportDirRules({
      vfsRepo,
      workplaceRepo,
      scope: SESSION_SCOPE,
      directoryPath: "/",
    });
    assert.equal(calls.vfsPrefix.length, 0);
    assert.equal(calls.listDirRulesScopeKeys.length, 0);
    assert.equal(calls.upserted.length, 0);
  });

  it("T-I6: 空差集零写入——已有行（含 rule_off）全部跳过", async () => {
    const { vfsRepo, workplaceRepo, calls } = makeStubs({
      directories: ["/角色", "/角色/开场"],
      existingRules: [
        buildDefaultDirRule("session:s1", "/角色"),
        { ...buildDefaultDirRule("session:s1", "/角色/开场"), ruleEnabled: false },
      ],
    });
    await ensureImportDirRules({
      vfsRepo,
      workplaceRepo,
      scope: SESSION_SCOPE,
      directoryPath: "/角色",
    });
    assert.equal(calls.upserted.length, 0);
  });

  it("T-I6: 吞错路径——listDirRules 抛错时 doesNotReject 且 console.warn 一次", async () => {
    const { vfsRepo, workplaceRepo } = makeStubs({
      listDirRulesError: new Error("workplace-boom"),
    });
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      await assert.doesNotReject(
        ensureImportDirRules({
          vfsRepo,
          workplaceRepo,
          scope: SESSION_SCOPE,
          directoryPath: "/角色",
        })
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnCalls.length, 1);
  });

  it("T-I4: scope 键空间分开算——查 VFS 用 vfs sk，读写 workplace 用 workplace sk", async () => {
    const { vfsRepo, workplaceRepo, calls } = makeStubs({
      directories: ["/角色", "/角色/世界书"],
    });
    await ensureImportDirRules({
      vfsRepo,
      workplaceRepo,
      scope: SESSION_SCOPE,
      directoryPath: "/角色",
    });
    // VFS 表查询用 vfs 键空间：session:${projectId}:${sessionId}
    assert.deepEqual(calls.vfsPrefix, [
      { scopeKey: "session:p1:s1", prefix: "/角色" },
    ]);
    // workplace 表读写用 workplace 键空间：session:${sessionId}
    assert.deepEqual(calls.listDirRulesScopeKeys, ["session:s1"]);
    assert.ok(calls.upserted.length > 0);
    for (const rule of calls.upserted) {
      assert.equal(rule.scopeKey, "session:s1");
    }
  });

  it("补行只覆盖无行目录，写入顺序无关且行内字段为默认启用", async () => {
    const { vfsRepo, workplaceRepo, calls } = makeStubs({
      directories: ["/角色", "/角色/开场", "/角色/世界书"],
      existingRules: [
        { ...buildDefaultDirRule("session:s1", "/角色/世界书"), ruleEnabled: false },
      ],
    });
    await ensureImportDirRules({
      vfsRepo,
      workplaceRepo,
      scope: SESSION_SCOPE,
      directoryPath: "/角色",
    });
    assert.deepEqual(
      calls.upserted.map((rule) => rule.logicalPath),
      ["/角色", "/角色/开场"]
    );
    for (const rule of calls.upserted) {
      assert.equal(rule.ruleEnabled, true);
      assert.equal(rule.headCount, 0);
      assert.equal(rule.tailCount, 1000);
      assert.equal(rule.fillPolicy, "header");
    }
  });
});

describe("ensureImportDirRules（真实 DB 等价性）", () => {
  it("helper 补入行与 WorkplaceService.setDirRule({logicalPath}) 产物逐字段等价", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-eq-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/角色");
    await vfs.mkdir("/角色/开场");

    // 左边：helper 直构补行
    await ensureImportDirRules({
      vfsRepo: new SqliteVfsEntryRepository(ctx.conn),
      workplaceRepo: new SqliteWorkplaceRepository(ctx.conn),
      scope,
      directoryPath: "/角色",
    });

    // 右边：另一个 session 走 WorkplaceService.setDirRule 逐目录设置
    const session2 = await ctx.sessions.create(project.id);
    const scope2 = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session2.id,
    };
    const vfs2 = ctx.sessionVfs(project.id, session2.id);
    await vfs2.mkdir("/角色");
    await vfs2.mkdir("/角色/开场");
    const wt2 = createWorkplaceService(ctx.conn, scope2);
    await wt2.setDirRule({ logicalPath: "/角色" });
    await wt2.setDirRule({ logicalPath: "/角色/开场" });

    const repo1 = new SqliteWorkplaceRepository(ctx.conn);
    const repo2 = new SqliteWorkplaceRepository(ctx.conn);
    // 两个 session 的 scopeKey 必然不同，归一化后对比其余全部字段
    const stripScopeKey = (rules: WorkplaceDirRule[]) =>
      rules
        .map(({ scopeKey: _sk, ...rest }) => rest)
        .sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
    assert.deepEqual(
      stripScopeKey(await repo1.listDirRules(`session:${session.id}`)),
      stripScopeKey(await repo2.listDirRules(`session:${session2.id}`))
    );
  });
});
