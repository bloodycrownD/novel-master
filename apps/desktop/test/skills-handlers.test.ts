/**
 * Skills IPC handlers：真实 DB 集成测（新建/清单/合并视图/读生效副本/
 * 负清单开关/删除/缺域拒绝/辅助文件）。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import {
  handleSkillsDelete,
  handleSkillsEffective,
  handleSkillsList,
  handleSkillsRead,
  handleSkillsToggle,
  handleSkillsUpdateInfo,
  handleSkillsWrite,
} from "../src/main/ipc/handlers/skills.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

function skillDoc(name: string, description: string, body = "正文"): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

describe("skills IPC handlers", () => {
  let tempDir: string;
  let projectId: string;
  let otherProjectId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-skills-"));

    const project = await handleProjectsCreate({ name: "skills-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    const other = await handleProjectsCreate({ name: "skills-ipc-other" });
    assert.equal(other.ok, true);
    if (other.ok) {
      otherProjectId = other.data.id;
    }

    // 项目技能 foo（后置全局同名副本，验证覆盖合并）
    const writeProject = await handleSkillsWrite({
      domain: "project",
      projectId,
      name: "foo",
      content: skillDoc("foo", "项目域技能"),
    });
    assert.equal(writeProject.ok, true);
    // 全局技能 bar + 同名 foo
    for (const [name, desc] of [
      ["bar", "全局技能"],
      ["foo", "全局同名技能"],
    ] as const) {
      const res = await handleSkillsWrite({
        domain: "global",
        name,
        content: skillDoc(name, desc),
      });
      assert.equal(res.ok, true);
    }
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("list 按域返回清单（含 files 与有效性）", async () => {
    const globalList = await handleSkillsList({ domain: "global" });
    assert.equal(globalList.ok, true);
    if (!globalList.ok) {
      return;
    }
    // 测试库 bootstrap 种入内置技能 agent-config，清单含它属预期
    assert.deepEqual(
      globalList.data.map((s) => s.name).sort(),
      ["agent-config", "bar", "foo"],
    );
    const foo = globalList.data.find((s) => s.name === "foo");
    assert.ok(foo);
    assert.equal(foo!.valid, true);
    assert.deepEqual(foo!.files, ["SKILL.md"]);

    const projectList = await handleSkillsList({
      domain: "project",
      projectId,
    });
    assert.equal(projectList.ok, true);
    if (projectList.ok) {
      assert.deepEqual(
        projectList.data.map((s) => s.name),
        ["foo"],
      );
    }
  });

  it("effective 合并视图：同名项目副本覆盖并标 overridden", async () => {
    const res = await handleSkillsEffective({ projectId });
    assert.equal(res.ok, true);
    if (!res.ok) {
      return;
    }
    // 含 bootstrap 种入的内置技能 agent-config（global 有效）
    assert.deepEqual(
      res.data.map((s) => s.name),
      ["agent-config", "bar", "foo"],
    );
    const foo = res.data.find((s) => s.name === "foo")!;
    assert.equal(foo.domain, "project");
    assert.equal(foo.overridden, true);
    assert.equal(foo.effective, true);
    const bar = res.data.find((s) => s.name === "bar")!;
    assert.equal(bar.domain, "global");
    assert.equal(bar.overridden, false);
  });

  it("read 缺省域解析生效副本，显式 domain 读原件", async () => {
    const effectiveRead = await handleSkillsRead({
      name: "foo",
      projectId,
    });
    assert.equal(effectiveRead.ok, true);
    if (effectiveRead.ok) {
      assert.equal(effectiveRead.data.domain, "project");
      assert.match(effectiveRead.data.content, /项目域技能/);
    }

    const globalRead = await handleSkillsRead({
      domain: "global",
      name: "foo",
    });
    assert.equal(globalRead.ok, true);
    if (globalRead.ok) {
      assert.equal(globalRead.data.domain, "global");
      assert.match(globalRead.data.content, /全局同名技能/);
    }
  });

  it("toggle 写当前项目负清单：禁用后 effective=false，启用恢复", async () => {
    const off = await handleSkillsToggle({
      projectId,
      name: "bar",
      disabled: true,
    });
    assert.equal(off.ok, true);

    const disabledView = await handleSkillsEffective({ projectId });
    assert.equal(disabledView.ok, true);
    if (disabledView.ok) {
      const bar = disabledView.data.find((s) => s.name === "bar")!;
      assert.equal(bar.disabled, true);
      assert.equal(bar.effective, false);
    }

    // 其他项目不受负清单影响
    if (otherProjectId != null) {
      const otherView = await handleSkillsEffective({
        projectId: otherProjectId,
      });
      assert.equal(otherView.ok, true);
      if (otherView.ok) {
        const bar = otherView.data.find((s) => s.name === "bar")!;
        assert.equal(bar.disabled, false);
      }
    }

    const on = await handleSkillsToggle({
      projectId,
      name: "bar",
      disabled: false,
    });
    assert.equal(on.ok, true);
    const restored = await handleSkillsEffective({ projectId });
    assert.equal(restored.ok, true);
    if (restored.ok) {
      const bar = restored.data.find((s) => s.name === "bar")!;
      assert.equal(bar.disabled, false);
      assert.equal(bar.effective, true);
    }
  });

  it("write 缺域返回 MISSING_DOMAIN；非法技能名返回 INVALID_NAME", async () => {
    const missingDomain = await handleSkillsWrite({
      name: "nope",
      content: skillDoc("nope", "缺域"),
      projectId,
    });
    assert.equal(missingDomain.ok, false);
    if (!missingDomain.ok) {
      assert.equal(missingDomain.error.code, "MISSING_DOMAIN");
    }

    const badName = await handleSkillsWrite({
      domain: "global",
      name: "has space",
      content: skillDoc("has space", "非法名"),
    });
    assert.equal(badName.ok, false);
    if (!badName.ok) {
      assert.equal(badName.error.code, "INVALID_NAME");
    }
  });

  it("delete 后清单与合并视图同步移除", async () => {
    const write = await handleSkillsWrite({
      domain: "project",
      projectId: otherProjectId,
      name: "foo",
      content: skillDoc("foo", "其他项目技能"),
    });
    assert.equal(write.ok, true);

    const removed = await handleSkillsDelete({
      domain: "project",
      projectId: otherProjectId,
      name: "foo",
    });
    assert.equal(removed.ok, true);

    const afterDelete = await handleSkillsList({
      domain: "project",
      projectId: otherProjectId,
    });
    assert.equal(afterDelete.ok, true);
    if (afterDelete.ok) {
      assert.equal(afterDelete.data.length, 0);
    }
  });

  it("辅助文件写入与读取（相对路径，缺省 SKILL.md）", async () => {
    const write = await handleSkillsWrite({
      domain: "project",
      projectId,
      name: "foo",
      path: "references/x.md",
      content: "辅助内容",
    });
    assert.equal(write.ok, true);

    const read = await handleSkillsRead({
      domain: "project",
      projectId,
      name: "foo",
      path: "references/x.md",
    });
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.data.content, "辅助内容");
    }

    const list = await handleSkillsList({ domain: "project", projectId });
    assert.equal(list.ok, true);
    if (list.ok) {
      const foo = list.data.find((s) => s.name === "foo")!;
      assert.ok(foo.files.includes("references/x.md"));
    }
  });

  it("updateInfo（T-S4）：改名成功迁移目录并同步 front matter，仅改描述不动目录", async () => {
    // 改名：新名可读且 front matter name 同步；旧名 NOT_FOUND
    const renamed = await handleSkillsUpdateInfo({
      domain: "global",
      name: "bar",
      newName: "bar-renamed",
    });
    assert.equal(renamed.ok, true);

    const readNew = await handleSkillsRead({ domain: "global", name: "bar-renamed" });
    assert.equal(readNew.ok, true);
    if (readNew.ok) {
      assert.match(readNew.data.content, /name: "bar-renamed"/);
    }
    const readOld = await handleSkillsRead({ domain: "global", name: "bar" });
    assert.equal(readOld.ok, false);
    if (!readOld.ok) {
      assert.equal(readOld.error.code, "NOT_FOUND");
    }

    // 仅改描述：目录不迁（同名可读）、description 更新
    const descRes = await handleSkillsUpdateInfo({
      domain: "global",
      name: "bar-renamed",
      description: "改过的描述",
    });
    assert.equal(descRes.ok, true);
    const list = await handleSkillsList({ domain: "global" });
    assert.equal(list.ok, true);
    if (list.ok) {
      const item = list.data.find((s) => s.name === "bar-renamed")!;
      assert.equal(item.description, "改过的描述");
    }
  });

  it("updateInfo（T-S4）：撞名与内置改名拒绝时错误码透传", async () => {
    // 域内撞名：SKILL_ALREADY_EXISTS（core 事务内错误解包后仍透传）
    const dup = await handleSkillsUpdateInfo({
      domain: "global",
      name: "bar-renamed",
      newName: "foo",
    });
    assert.equal(dup.ok, false);
    if (!dup.ok) {
      assert.equal(dup.error.code, "SKILL_ALREADY_EXISTS");
      assert.match(dup.error.message, /已存在同名技能/);
    }

    // global 域内置技能改名拒：BUILTIN_SKILL_RENAME（内置源门先于
    // 存在性检查，不依赖目录状态）
    const builtinRes = await handleSkillsUpdateInfo({
      domain: "global",
      name: "agent-config",
      newName: "agent-config-renamed",
    });
    assert.equal(builtinRes.ok, false);
    if (!builtinRes.ok) {
      assert.equal(builtinRes.error.code, "BUILTIN_SKILL_RENAME");
      assert.match(builtinRes.error.message, /内置技能不支持重命名：agent-config/);
    }
  });
});
