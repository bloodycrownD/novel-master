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
import { createSkillsService } from "@novel-master/core/skills";
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
 * 编译期断言：`PhysicalVfsService` 除 list/read/listTree 外不得有任何成员
 * （一旦出现写方法，此赋值的类型不再收窄为 true，tsc 会报错）。
 */
type PhysicalNoWriteMethods = Exclude<
  keyof PhysicalVfsService,
  "list" | "read" | "listTree"
>;
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
    // 技能造数必须经 SkillsService（写 /meta/skills/... 约定），
    // 禁止 meta 域 vfs 直写（旧 /skills/... 直写是错误约定，会掩盖双前缀冲突）
    const skills = createSkillsService(ctx.conn);
    await skills.writeSkillFile(
      "global",
      `global-skill-${suffix}`,
      undefined,
      "S",
    );

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
    // 项目技能同样经 SkillsService 造数（meta 域约定）
    await createSkillsService(ctx.conn).writeSkillFile(
      "project",
      `proj-skill-${suffix}`,
      undefined,
      "PS",
      p1.id,
    );
    const s1 = await ctx.sessions.create(p1.id, `首个会话-${suffix}`);
    const s1vfs = ctx.sessionVfs(p1.id, s1.id);
    await s1vfs.write(`/s-only-${suffix}.md`, "SESSION");
    // 未命名会话（title 为 null）：不填 label，展示层回退 UUID
    const sUntitled = await ctx.sessions.create(p1.id);

    // 项目 2：空项目、无会话
    const p2 = await ctx.projects.create(`P2-${suffix}`);

    const svc = createPhysicalVfsService(ctx.conn);

    // /projects 下两个项目目录行（含空项目），label = 项目名（展示用，替代 UUID）
    const projectRows = await svc.list("/projects");
    assert.ok(
      projectRows.some(
        (r) =>
          r.kind === "directory" &&
          r.path === `/projects/${p1.id}` &&
          r.label === `P1-${suffix}`,
      ),
    );
    assert.ok(
      projectRows.some(
        (r) =>
          r.kind === "directory" &&
          r.path === `/projects/${p2.id}` &&
          r.label === `P2-${suffix}`,
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
    // 会话目录行：有 title 的带 label，未命名的无 label 键（回退 UUID）；按名字排在前
    const sessionRows = await svc.list(`/projects/${p1.id}/sessions`);
    const s1Row = sessionRows.find(
      (r) => r.path === `/projects/${p1.id}/sessions/${s1.id}`,
    );
    assert.ok(s1Row != null && s1Row.label === `首个会话-${suffix}`);
    const untitledRow = sessionRows.find(
      (r) => r.path === `/projects/${p1.id}/sessions/${sUntitled.id}`,
    );
    assert.ok(untitledRow != null && untitledRow.label === undefined);
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
    await createSkillsService(ctx.conn).writeSkillFile(
      "global",
      `gm-${suffix}`,
      undefined,
      "GLOBAL-META",
    );
    const project = await ctx.projects.create(`P-${suffix}`);
    await ctx.projectVfs(project.id).write(`/pt-${suffix}.md`, "PROJECT");
    await createSkillsService(ctx.conn).writeSkillFile(
      "project",
      `pm-${suffix}`,
      undefined,
      "PROJECT-META",
      project.id,
    );
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

describe("listTree: 批量全树拉取（desktop/B-2 core 半边）", () => {
  /** 逐层 list 的 BFS 展开（懒加载参照实现，用于与 listTree 对拍）。 */
  async function expandByList(
    svc: PhysicalVfsService,
    dir: string,
  ): Promise<VfsListEntry[]> {
    const rows = await svc.list(dir);
    const out: VfsListEntry[] = [];
    for (const row of rows) {
      out.push(row);
      if (row.kind === "directory") {
        out.push(...(await expandByList(svc, row.path)));
      }
    }
    return out;
  }

  /** 排序归一（path+kind+label）后比较两个行集是否一致。 */
  function normalize(rows: VfsListEntry[]): string[] {
    return rows
      .map((r) => `${r.kind}|${r.path}|${r.label ?? ""}`)
      .sort();
  }

  it("单 scope 一次前缀查询后递归切出全部层级行（global-meta 技能树）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    // 经 SkillsService 造数（/meta/skills/... 约定），含辅助文件形成多层
    const skills = createSkillsService(ctx.conn);
    const name = `tree-skill-${suffix}`;
    await skills.writeSkillFile("global", name, undefined, "入口");
    await skills.writeSkillFile(
      "global",
      name,
      "notes/deep/ref.md",
      "深层辅助文件",
    );

    const svc = createPhysicalVfsService(ctx.conn);
    const rows = await svc.listTree("/meta");
    // 全部层级行一次返回；目录行在前、文件行在后，同层按展示键
    // （无 label 用路径末段）排序，故目录间按 basename 而非全路径排
    const expected = [
      { path: `/meta/skills/${name}/notes/deep`, kind: "directory" },
      { path: `/meta/skills/${name}/notes`, kind: "directory" },
      { path: "/meta/skills", kind: "directory" },
      { path: `/meta/skills/${name}`, kind: "directory" },
      { path: `/meta/skills/${name}/SKILL.md`, kind: "file" },
      { path: `/meta/skills/${name}/notes/deep/ref.md`, kind: "file" },
    ];
    assert.deepEqual(
      rows.filter((r) => r.path.startsWith(`/meta/skills/${name}`) || r.path === "/meta/skills"),
      expected,
    );
  });

  it("虚拟目录（projects/sessions 枚举）也在本接口合成，与逐层 list 结果一致", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-tree-${suffix}`);
    await ctx.projectVfs(project.id).write(`/pt-${suffix}.md`, "P");
    await createSkillsService(ctx.conn).writeSkillFile(
      "project",
      `pt-skill-${suffix}`,
      undefined,
      "PS",
      project.id,
    );
    const main = await ctx.sessions.create(project.id, `主会话-${suffix}`);
    await ctx.sessionVfs(project.id, main.id).write(`/s-${suffix}.md`, "S");
    const child = await ctx.sessions.createSubSession(
      main.id,
      project.id,
      `子会话-${suffix}`,
    );
    await ctx.globalVfs().write(`/g-${suffix}.md`, "G");

    const svc = createPhysicalVfsService(ctx.conn);
    const tree = await svc.listTree("/");
    // 根树包含三挂载点与项目/会话虚拟目录行（子会话目录行同样合成）
    assert.ok(tree.some((r) => r.path === "/template" && r.kind === "directory"));
    assert.ok(
      tree.some(
        (r) =>
          r.path === `/projects/${project.id}` &&
          r.label === `P-tree-${suffix}`,
      ),
    );
    assert.ok(
      tree.some(
        (r) => r.path === `/projects/${project.id}/sessions/${child.id}`,
      ),
    );
    // 与逐层 list 的 BFS 展开对拍：同一棵树、同一批行
    assert.deepEqual(normalize(tree), normalize(await expandByList(svc, "/")));
  });

  it("子树入口与不存在路径：子树只含后代行，非域前缀报 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-sub-${suffix}`);
    await ctx.projectVfs(project.id).write(`/a/${suffix}.md`, "A");
    const svc = createPhysicalVfsService(ctx.conn);

    const subTree = await svc.listTree(`/projects/${project.id}/template`);
    // 子树只含后代行（含隐含中间目录行），根自身不返回
    assert.deepEqual(subTree, [
      { path: `/projects/${project.id}/template/a`, kind: "directory" },
      { path: `/projects/${project.id}/template/a/${suffix}.md`, kind: "file" },
    ]);

    await assert.rejects(svc.listTree("/nope"), (err: unknown) => {
      assert.ok(isVfsError(err));
      assert.equal(err.code, "NOT_FOUND");
      return true;
    });
  });
});

describe("core/B-1: 排序键统一 label ?? 路径末段", () => {
  it("命名/未命名项目混排按展示键稳定排序，未命名不再恒排最前", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    // "0-" 在字典序上恒小于任何 UUID 首段（十六进制 0-9a-f，且 '-' 小于全部
    // 十六进制字符），而旧排序键 "/projects/{uuid}" 恒小于 "0-..."：
    // 本构造下新旧排序顺序必然相反，可确定性地回归旧缺陷（未命名恒排最前）
    const unnamed = await ctx.projects.create(`z占位-${suffix}`);
    const named = await ctx.projects.create(`0-${suffix}`);

    const svc = createPhysicalVfsService(ctx.conn);
    const rows = (await svc.list("/projects")).filter(
      (r) =>
        r.path === `/projects/${named.id}` ||
        r.path === `/projects/${unnamed.id}`,
    );
    assert.deepEqual(
      rows.map((r) => r.path),
      [`/projects/${named.id}`, `/projects/${unnamed.id}`],
    );
  });
});

describe("core/G-1: 子 agent 会话展开 + 跨项目 sid 守卫", () => {
  it("主会话带多层子 agent 会话：sessions 目录 BFS 展开子/孙会话目录行", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-g1-${suffix}`);
    const main = await ctx.sessions.create(project.id, `主会话-${suffix}`);
    const child = await ctx.sessions.createSubSession(
      main.id,
      project.id,
      `子会话-${suffix}`,
    );
    const grand = await ctx.sessions.createSubSession(
      child.id,
      project.id,
      `孙会话-${suffix}`,
    );

    const svc = createPhysicalVfsService(ctx.conn);
    const rows = await svc.list(`/projects/${project.id}/sessions`);
    const paths = rows.map((r) => r.path);
    assert.ok(
      paths.includes(`/projects/${project.id}/sessions/${main.id}`),
      "主会话目录行应出现",
    );
    assert.ok(
      paths.includes(`/projects/${project.id}/sessions/${child.id}`),
      "子 agent 会话目录行应 BFS 展开",
    );
    assert.ok(
      paths.includes(`/projects/${project.id}/sessions/${grand.id}`),
      "孙 agent 会话目录行应逐层展开",
    );
    const childRow = rows.find(
      (r) => r.path === `/projects/${project.id}/sessions/${child.id}`,
    );
    assert.equal(childRow?.label, `子会话-${suffix}`);
  });

  it("A 项目路径 + B 项目 sid：list/read 均报 NOT_FOUND", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const projectA = await ctx.projects.create(`PA-g1-${suffix}`);
    const projectB = await ctx.projects.create(`PB-g1-${suffix}`);
    const sessionB = await ctx.sessions.create(projectB.id, `B会话-${suffix}`);

    const svc = createPhysicalVfsService(ctx.conn);
    await assert.rejects(
      svc.list(`/projects/${projectA.id}/sessions/${sessionB.id}`),
      (err: unknown) => {
        assert.ok(isVfsError(err));
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
    await assert.rejects(
      svc.read(`/projects/${projectA.id}/sessions/${sessionB.id}/x.md`),
      (err: unknown) => {
        assert.ok(isVfsError(err));
        assert.equal(err.code, "NOT_FOUND");
        return true;
      },
    );
  });
});

describe("core/G-2: read 挂载点根一律 NOT_FOUND", () => {
  it("六处挂载点根 read 均报 NOT_FOUND（目录行归一为无此文件）", async () => {
    const ctx = getNovelMasterTestContext();
    const suffix = testIsolationSuffix();
    const project = await ctx.projects.create(`P-g2-${suffix}`);
    // 种上技能，让 /meta 与 /projects/{pid}/meta 落在显式目录行上
    //（否则查无 entry，测不到 IS_DIRECTORY → NOT_FOUND 归一分支）
    const skills = createSkillsService(ctx.conn);
    await skills.writeSkillFile(
      "global",
      `g2-global-${suffix}`,
      undefined,
      "全局",
    );
    await skills.writeSkillFile(
      "project",
      `g2-project-${suffix}`,
      undefined,
      "项目",
      project.id,
    );
    const session = await ctx.sessions.create(project.id);

    const svc = createPhysicalVfsService(ctx.conn);
    const mountRoots = [
      "/template",
      "/meta",
      `/projects/${project.id}`,
      `/projects/${project.id}/template`,
      `/projects/${project.id}/meta`,
      `/projects/${project.id}/sessions/${session.id}`,
    ];
    for (const path of mountRoots) {
      await assert.rejects(
        svc.read(path),
        (err: unknown) => {
          assert.ok(isVfsError(err), `${path} 应抛 VfsError`);
          assert.equal(err.code, "NOT_FOUND", `${path} 应为 NOT_FOUND`);
          return true;
        },
      );
    }
  });
});
