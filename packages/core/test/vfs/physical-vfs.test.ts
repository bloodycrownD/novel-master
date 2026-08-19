/**
 * 只读物理树服务测试（global-fs-manager Step 4 T-PB1 / T-PB2）。
 *
 * T-PB1：物理根/项目层列目录——挂载点合成目录行 + 各域文件行 + 空项目/空会话目录行。
 * T-PB2：read 五前缀解析正确（含不存在路径报错）+ 服务无任何写方法（类型断言）。
 *
 * @module test/vfs/physical-vfs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPhysicalVfsService,
  isVfsError,
  type PhysicalVfsService,
} from "@novel-master/core/vfs";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/**
 * 编译期断言：`PhysicalVfsService` 除 list/read 外不得有任何成员
 * （一旦出现写方法，此赋值的类型不再收窄为 true，tsc 会报错）。
 */
type PhysicalNoWriteMethods = Exclude<keyof PhysicalVfsService, "list" | "read">;
const assertNoWriteMethods: PhysicalNoWriteMethods extends never
  ? true
  : { 出现了写方法: PhysicalNoWriteMethods } = true;
void assertNoWriteMethods;

describe("T-PB1: 物理树列目录（合成目录 + 各域拼接）", () => {
  it("物理根 = template/meta/projects 三个挂载点目录行", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createPhysicalVfsService(ctx.conn);
    assert.deepEqual(await svc.list("/"), [
      { path: "/meta", kind: "directory" },
      { path: "/projects", kind: "directory" },
      { path: "/template", kind: "directory" },
    ]);
  });

  it("全局普通文件落 /template，全局技能落 /meta/skills", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    await ctx.globalVfs().write(`/root-${suffix}.md`, "G");
    await ctx.globalMetaVfs().mkdir("/skills");
    await ctx
      .globalMetaVfs()
      .write(`/skills/global-skill-${suffix}/SKILL.md`, "S");

    const svc = createPhysicalVfsService(ctx.conn);
    const templateRows = await svc.list("/template");
    assert.ok(
      templateRows.some(
        (r) => r.kind === "file" && r.path === `/template/root-${suffix}.md`,
      ),
    );
    assert.deepEqual(await svc.list("/meta"), [
      { path: "/meta/skills", kind: "directory" },
    ]);
    const skillRows = await svc.list("/meta/skills");
    assert.ok(
      skillRows.some(
        (r) =>
          r.kind === "directory" &&
          r.path === `/meta/skills/global-skill-${suffix}`,
      ),
    );
  });

  it("项目树合成：template/meta/sessions 子目录齐全，空项目与空会话也显示目录行", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();

    // 项目 1：三个子域都有内容 + 一个会话
    const p1 = await ctx.projects.create(`P1-${suffix}`);
    await ctx.projectVfs(p1.id).write(`/p1-${suffix}.md`, "P1");
    await ctx
      .projectMetaVfs(p1.id)
      .write(`/skills/proj-skill-${suffix}/SKILL.md`, "PS");
    const s1 = await ctx.sessions.create(p1.id);
    const s1vfs = ctx.sessionVfs(p1.id, s1.id);
    await s1vfs.write(`/s-only-${suffix}.md`, "SESSION");

    // 项目 2：空项目、无会话
    const p2 = await ctx.projects.create(`P2-${suffix}`);

    const svc = createPhysicalVfsService(ctx.conn);

    // /projects 下两个项目目录行（含空项目）
    const projectRows = await svc.list("/projects");
    assert.ok(
      projectRows.some(
        (r) => r.kind === "directory" && r.path === `/projects/${p1.id}`,
      ),
    );
    assert.ok(
      projectRows.some(
        (r) => r.kind === "directory" && r.path === `/projects/${p2.id}`,
      ),
    );

    // 项目 1：三个子域挂载点目录行
    assert.deepEqual(await svc.list(`/projects/${p1.id}`), [
      { path: `/projects/${p1.id}/template`, kind: "directory" },
      { path: `/projects/${p1.id}/meta`, kind: "directory" },
      { path: `/projects/${p1.id}/sessions`, kind: "directory" },
    ]);
    // 各子域内容行（拼物理前缀）
    const p1Template = await svc.list(`/projects/${p1.id}/template`);
    assert.ok(
      p1Template.some(
        (r) =>
          r.kind === "file" &&
          r.path === `/projects/${p1.id}/template/p1-${suffix}.md`,
      ),
    );
    const p1Meta = await svc.list(`/projects/${p1.id}/meta`);
    assert.ok(
      p1Meta.some(
        (r) =>
          r.kind === "directory" &&
          r.path === `/projects/${p1.id}/meta/skills`,
      ),
    );
    // 会话目录行 + 会话域文件行
    assert.deepEqual(await svc.list(`/projects/${p1.id}/sessions`), [
      { path: `/projects/${p1.id}/sessions/${s1.id}`, kind: "directory" },
    ]);
    const s1Rows = await svc.list(`/projects/${p1.id}/sessions/${s1.id}`);
    assert.ok(
      s1Rows.some(
        (r) =>
          r.kind === "file" &&
          r.path === `/projects/${p1.id}/sessions/${s1.id}/s-only-${suffix}.md`,
      ),
    );

    // 空项目：三个子域挂载点目录行照样显示；空 sessions 列表为空
    assert.deepEqual(await svc.list(`/projects/${p2.id}`), [
      { path: `/projects/${p2.id}/template`, kind: "directory" },
      { path: `/projects/${p2.id}/meta`, kind: "directory" },
      { path: `/projects/${p2.id}/sessions`, kind: "directory" },
    ]);
    assert.deepEqual(await svc.list(`/projects/${p2.id}/template`), []);
    assert.deepEqual(await svc.list(`/projects/${p2.id}/sessions`), []);
  });

  it("不存在或不落任何域前缀的目录报 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createPhysicalVfsService(ctx.conn);
    await assert.rejects(svc.list("/nope"), (err: unknown) => {
      assert.ok(isVfsError(err));
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
    await assert.rejects(
      svc.list(`/projects/nonexistent-${testIsolationSuffix()}`),
      (err: unknown) => {
        assert.ok(isVfsError(err));
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });
});

describe("T-PB2: read 五前缀解析 + 无写方法", () => {
  it("read 按顺序敏感前缀解析到正确的 scope", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();

    await ctx.globalVfs().write(`/g-${suffix}.md`, "GLOBAL");
    await ctx
      .globalMetaVfs()
      .write(`/skills/gm-${suffix}/SKILL.md`, "GLOBAL-META");
    const project = await ctx.projects.create(`P-${suffix}`);
    await ctx.projectVfs(project.id).write(`/pt-${suffix}.md`, "PROJECT");
    await ctx
      .projectMetaVfs(project.id)
      .write(`/skills/pm-${suffix}/SKILL.md`, "PROJECT-META");
    const session = await ctx.sessions.create(project.id);
    await ctx
      .sessionVfs(project.id, session.id)
      .write(`/ss-${suffix}.md`, "SESSION");

    const svc = createPhysicalVfsService(ctx.conn);
    assert.equal(
      (await svc.read(`/template/g-${suffix}.md`)).content,
      "GLOBAL",
    );
    assert.equal(
      (await svc.read(`/meta/skills/gm-${suffix}/SKILL.md`)).content,
      "GLOBAL-META",
    );
    assert.equal(
      (await svc.read(`/projects/${project.id}/template/pt-${suffix}.md`))
        .content,
      "PROJECT",
    );
    assert.equal(
      (
        await svc.read(
          `/projects/${project.id}/meta/skills/pm-${suffix}/SKILL.md`,
        )
      ).content,
      "PROJECT-META",
    );
    assert.equal(
      (
        await svc.read(
          `/projects/${project.id}/sessions/${session.id}/ss-${suffix}.md`,
        )
      ).content,
      "SESSION",
    );

    // read 返回的 path 回写为物理路径
    const readBack = await svc.read(`/template/g-${suffix}.md`);
    assert.equal(readBack.path, `/template/g-${suffix}.md`);
  });

  it("read 不存在路径报 NOT_FOUND（含不落任何域前缀的路径）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createPhysicalVfsService(ctx.conn);
    const suffix = testIsolationSuffix();
    // 文件不存在（域前缀合法）
    await assert.rejects(
      svc.read(`/template/absent-${suffix}.md`),
      (err: unknown) => {
        assert.ok(isVfsError(err));
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
    // 不落任何域前缀
    await assert.rejects(svc.read("/nope/x.md"), (err: unknown) => {
      assert.ok(isVfsError(err));
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
  });

  it("服务无任何写方法（运行时成员枚举 + 编译期类型断言）", async () => {
    const ctx = getNovelMasterTestContext();
    const svc = createPhysicalVfsService(ctx.conn);
    // 运行时：原型上不得出现任何写方法名（私有列目录辅助方法允许存在）
    const writeMethods = [
      "write",
      "mkdir",
      "delete",
      "replace",
      "renamePath",
      "renamePrefix",
      "hardDelete",
      "resetHeadToVersion",
      "move",
      "copy",
    ];
    const ownMethods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(svc),
    ).filter((name) => name !== "constructor");
    for (const name of ownMethods) {
      assert.ok(
        !writeMethods.includes(name),
        `PhysicalVfsService 不得出现写方法 ${name}`,
      );
    }
    // 编译期断言见文件顶部 assertNoWriteMethods
    void assertNoWriteMethods;
  });
});
