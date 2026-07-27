import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  CharacterCardError,
  createCharacterCardImportService,
  parseCharacterCardToMdTree,
  type VfsService,
} from "@novel-master/core/vfs";
import { createWorkplaceService } from "@novel-master/core/workplace";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import {
  buildBrokenPngBytes,
  buildPngWithTextChara,
} from "./helpers/png-chara-fixture.js";

novelMasterTestFixture();

async function listFilePaths(vfs: VfsService, dir = "/"): Promise<string[]> {
  const entries = await vfs.list(dir, { recursive: true });
  return entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.path)
    .sort();
}

const SAMPLE_V2 = {
  spec: "chara_card_v2",
  data: {
    description: "导入描述",
    first_mes: "开场一",
    character_book: {
      entries: [
        { comment: "设定", keys: ["k1"], content: "世界书正文" },
      ],
    },
  },
};

describe("CharacterCardImportService", () => {
  it("T-C7: 目标 /角色 覆盖且同级 /大纲 保留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc7-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/角色/旧文件.md", "old");
    await vfs.write("/大纲/保留.md", "outline");

    const svc = createCharacterCardImportService(ctx.conn);
    const tree = parseCharacterCardToMdTree(JSON.stringify(SAMPLE_V2));
    await svc.import(scope, tree, {
      confirmed: true,
      directoryPath: "/角色",
    });

    assert.equal((await vfs.read("/角色/角色描述.md")).content, "导入描述");
    assert.equal((await vfs.read("/角色/开场/开场001.md")).content, "开场一");
    assert.ok(
      (await vfs.read("/角色/世界书/设定.md")).content.includes("世界书正文"),
    );
    await assert.rejects(() => vfs.read("/角色/旧文件.md"));
    assert.equal((await vfs.read("/大纲/保留.md")).content, "outline");
  });

  it("T-C8: confirmed:false → NOT_CONFIRMED，子树不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc8-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/角色/stay.md", "stay");

    const svc = createCharacterCardImportService(ctx.conn);
    const tree = parseCharacterCardToMdTree(JSON.stringify(SAMPLE_V2));
    await assert.rejects(
      () =>
        svc.import(scope, tree, {
          confirmed: false,
          directoryPath: "/角色",
        }),
      (e: unknown) =>
        e instanceof CharacterCardError && e.code === "NOT_CONFIRMED",
    );
    assert.equal((await vfs.read("/角色/stay.md")).content, "stay");
  });

  it("G-1/Z5: Phase B insert 失败整事务回滚", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-g1-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    // 对齐 ZIP Z5：目标子树先写旧文件，insert 钩子失败后应整事务回滚
    await vfs.write("/角色/旧文件.md", "old");

    const svc = createCharacterCardImportService(ctx.conn, {
      testHook: { throwOnInsertLogical: "/角色/角色描述.md" },
    });
    const tree = parseCharacterCardToMdTree(JSON.stringify(SAMPLE_V2));
    await assert.rejects(() =>
      svc.import(scope, tree, {
        confirmed: true,
        directoryPath: "/角色",
      }),
    );

    assert.equal((await vfs.read("/角色/旧文件.md")).content, "old");
    await assert.rejects(() => vfs.read("/角色/角色描述.md"));
  });

  it("T-C9: importFromBytes 解析失败 → 子树不变", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc9-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.write("/角色/stay.md", "stay-bytes");

    let deleteReached = false;
    const hooked = createCharacterCardImportService(ctx.conn, {
      testHook: {
        onBeforeDeletePrefix: () => {
          deleteReached = true;
        },
      },
    });
    await assert.rejects(
      () =>
        hooked.importFromBytes(scope, buildBrokenPngBytes(), {
          confirmed: true,
          directoryPath: "/角色",
        }),
      (e: unknown) =>
        e instanceof CharacterCardError && e.code === "NOT_CHARACTER_CARD",
    );
    assert.equal(deleteReached, false);
    assert.equal((await vfs.read("/角色/stay.md")).content, "stay-bytes");
  });

  it("T-C15: 导入成功后 workplace 规则表未被清理/重写", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-tc15-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.mkdir("/角色");
    await vfs.write("/角色/旧.md", "old");

    const wt = createWorkplaceService(ctx.conn, scope);
    await wt.setDirRule({
      logicalPath: "/角色",
      sortField: "name",
      sortOrder: "asc",
      headCount: 7,
      tailCount: 1,
      fillPolicy: "filename",
    });
    const before = await wt.getDirRule("/角色");
    assert.ok(before);
    assert.equal(before.headCount, 7);

    const svc = createCharacterCardImportService(ctx.conn);
    await svc.importFromBytes(
      scope,
      new TextEncoder().encode(JSON.stringify(SAMPLE_V2)),
      { confirmed: true, directoryPath: "/角色" },
    );

    const after = await wt.getDirRule("/角色");
    assert.ok(after);
    assert.equal(after.headCount, 7);
    assert.equal(after.sortField, "name");
    assert.equal(after.fillPolicy, "filename");

    // 源码契约：角色卡导入路径禁止调用 WorkplaceService
    const here = dirname(fileURLToPath(import.meta.url));
    const implSrc = readFileSync(
      join(
        here,
        "../../src/service/vfs/impl/character-card-import.service.ts",
      ),
      "utf8",
    );
    assert.equal(
      /WorkplaceService|createWorkplaceService|workplace\.service/i.test(
        implSrc,
      ),
      false,
    );
  });

  it("T-C16: fixture PNG 经 importFromBytes 落盘子树", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-tc16-${testIsolationSuffix()}`,
    );
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    await vfs.mkdir("/角色");

    const bytes = buildPngWithTextChara({
      spec: "chara_card_v2",
      data: { description: "PNG落盘" },
    });
    const expected = parseCharacterCardToMdTree(bytes);
    const svc = createCharacterCardImportService(ctx.conn);
    await svc.importFromBytes(scope, bytes, {
      confirmed: true,
      directoryPath: "/角色",
    });

    for (const [rel, content] of expected) {
      const logical = `/角色/${rel}`;
      assert.equal((await vfs.read(logical)).content, content);
    }
    const files = await listFilePaths(vfs, "/角色");
    assert.deepEqual(
      files,
      [...expected.keys()].map((k) => `/角色/${k}`).sort(),
    );
  });

  it("合成树首段为开场/世界书时不因目标 basename 误杀", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-basename-${testIsolationSuffix()}`,
    );
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };
    // 目标目录名与合成树首段无关；即使叫「开场」也不应套 ZIP basename 前缀规则
    await vfs.mkdir("/开场");

    const svc = createCharacterCardImportService(ctx.conn);
    const tree = parseCharacterCardToMdTree(
      JSON.stringify({
        spec: "chara_card_v2",
        data: {
          description: "d",
          first_mes: "hi",
        },
      }),
    );
    await svc.import(scope, tree, {
      confirmed: true,
      directoryPath: "/开场",
    });
    assert.equal((await vfs.read("/开场/角色描述.md")).content, "d");
    assert.equal((await vfs.read("/开场/开场/开场001.md")).content, "hi");
  });

  it("导入后删无关文件再 capture 不抛 Revision not found", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(
      `P-rev-seed-${testIsolationSuffix()}`,
    );
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const scope = {
      kind: "session" as const,
      projectId: project.id,
      sessionId: session.id,
    };

    const svc = createCharacterCardImportService(ctx.conn);
    const tree = parseCharacterCardToMdTree(
      JSON.stringify({
        spec: "chara_card_v2",
        data: {
          description: "角色正文",
          first_mes: "开场一",
          character_book: {
            entries: [
              { comment: "世界观", keys: ["k1"], content: "世界书正文" },
            ],
          },
        },
      }),
    );
    await svc.import(scope, tree, {
      confirmed: true,
      directoryPath: "/角色",
    });

    assert.equal(
      (await vfs.read("/角色/世界书/世界观.md")).content.includes("世界书正文"),
      true,
    );

    // 删无关文件（模拟用户删 状态栏/开场），保留世界书
    await vfs.delete("/角色/开场/开场001.md");

    const user = await ctx.messages.append(session.id, "user", {
      blocks: [{ type: "text", text: "你好" }],
    });
    await assert.doesNotReject(() =>
      ctx.messageCheckpoint.capture(session.id, project.id, user.id),
    );

    // 再导入后再次 capture（回滚清空后再导入的场景）
    await svc.import(scope, tree, {
      confirmed: true,
      directoryPath: "/角色",
    });
    const user2 = await ctx.messages.append(session.id, "user", {
      blocks: [{ type: "text", text: "再问" }],
    });
    await assert.doesNotReject(() =>
      ctx.messageCheckpoint.capture(session.id, project.id, user2.id),
    );
  });
});
