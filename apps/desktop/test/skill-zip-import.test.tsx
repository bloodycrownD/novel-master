/**
 * 技能 ZIP 导入并入新建弹窗（desktop 同步 mobile 9a04dee）：
 * - 主进程 zipImportBytes：字节直写 /meta/skills/{name}（SKILL.md + 附属文件），
 *   非 zip 字节拒绝；global/project 两域各自落盘。
 * - withSkillFrontMatterValues：表单值重写 front matter（保留其余键与正文）；
 *   已回收为 core 单源，本文件经 @shared/logic/skills 消费同一实现。
 * - NewSkillModal：默认渲染「从 ZIP 导入…」入口；imported 分支落盘前过
 *   保留名新建门（ipcSkillsAssertCreateName，CR D-1）；version 残留已清理
 *   （T-S6：无 readRes / version 传参）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildVfsZip } from "@novel-master/core/vfs";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import {
  handleSkillsAssertCreateName,
  handleSkillsList,
  handleSkillsRead,
} from "../src/main/ipc/handlers/skills.js";
import { handleVfsZipImportBytes } from "../src/main/ipc/handlers/vfs.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";
import { withSkillFrontMatterValues } from "@shared/logic/skills";
import { NewSkillModal } from "@/features/skills/NewSkillModal";
import { SkillInfoEditModal } from "@/features/skills/SkillInfoEditModal";

function skillZipBytes(
  name: string,
  description: string,
): Uint8Array {
  const files = new Map<string, string>([
    [
      "SKILL.md",
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n正文。\n`,
    ],
    ["references/notes.md", "附属文件内容。\n"],
  ]);
  return buildVfsZip(files, ["references"]);
}

describe("VFS zipImportBytes handler（技能整包落盘）", () => {
  let tempDir: string;
  let projectId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-skill-zip-"));
    const project = await handleProjectsCreate({ name: "skill-zip-import" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("项目域整包导入：SKILL.md 与附属文件均落盘", async () => {
    const res = await handleVfsZipImportBytes({
      workspaceScope: "project-meta",
      projectId,
      bytes: skillZipBytes("zip-skill", "来自 zip 的技能"),
      confirmed: true,
      directoryPath: "/meta/skills/zip-skill",
    });
    assert.equal(res.ok, true);

    const list = await handleSkillsList({ domain: "project", projectId });
    assert.equal(list.ok, true);
    if (!list.ok) {
      return;
    }
    const row = list.data.find((s) => s.name === "zip-skill");
    assert.ok(row != null, "导入后技能应出现在项目域清单");
    assert.deepEqual(row?.files, ["SKILL.md", "references/notes.md"]);

    const skillMd = await handleSkillsRead({
      domain: "project",
      projectId,
      name: "zip-skill",
    });
    assert.equal(skillMd.ok, true);
    if (skillMd.ok) {
      assert.match(skillMd.data.content, /name: zip-skill/);
      assert.match(skillMd.data.content, /正文。/);
    }

    const ref = await handleSkillsRead({
      domain: "project",
      projectId,
      name: "zip-skill",
      path: "references/notes.md",
    });
    assert.equal(ref.ok, true);
    if (ref.ok) {
      assert.equal(ref.data.content, "附属文件内容。\n");
    }
  });

  it("全局域整包导入：落入全局技能目录", async () => {
    const res = await handleVfsZipImportBytes({
      workspaceScope: "global-meta",
      bytes: skillZipBytes("zip-global-skill", "全局 zip 技能"),
      confirmed: true,
      directoryPath: "/meta/skills/zip-global-skill",
    });
    assert.equal(res.ok, true);

    const list = await handleSkillsList({ domain: "global" });
    assert.equal(list.ok, true);
    if (!list.ok) {
      return;
    }
    assert.ok(
      list.data.some((s) => s.name === "zip-global-skill"),
      "导入后技能应出现在全局域清单",
    );
  });

  it("非 zip 字节拒绝（VfsZipError 落 name 兕底路径，message 含 not a ZIP）", async () => {
    const res = await handleVfsZipImportBytes({
      workspaceScope: "global-meta",
      bytes: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
      confirmed: true,
      directoryPath: "/meta/skills/bad",
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "VfsZipError");
      assert.match(res.error.message, /not a ZIP/i);
    }
  });
});

describe("withSkillFrontMatterValues（表单值重写 front matter，core 单源）", () => {
  it("替换既有 name/description，保留其余键与正文", () => {
    const source =
      "---\nname: old-name\ndescription: 旧描述\nextra: 保留\n---\n\n正文。\n";
    const out = withSkillFrontMatterValues(source, {
      name: "new-name",
      description: "含: 冒号的描述",
    });
    assert.match(out, /^---\nname: "new-name"\ndescription: "含: 冒号的描述"\nextra: 保留\n---\n\n正文。\n$/);
  });

  it("缺失 name/description 键时补全", () => {
    const source = "---\nname: old\n---\n\n正文。\n";
    const out = withSkillFrontMatterValues(source, {
      name: "old",
      description: "新描述",
    });
    assert.match(out, /description: "新描述"/);
    assert.match(out, /name: "old"/);
  });

  it("无 front matter 块时前置补一个", () => {
    const out = withSkillFrontMatterValues("只有正文。\n", {
      name: "n",
      description: "d",
    });
    assert.match(out, /^---\nname: "n"\ndescription: "d"\n---\n\n只有正文。\n$/);
  });
});

describe("NewSkillModal（ZIP 导入入口）", () => {
  it("未导入时渲染「从 ZIP 导入…」按钮", () => {
    const html = renderToStaticMarkup(
      <NewSkillModal
        open
        projects={[]}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    assert.match(html, /从 ZIP 导入…/);
  });

  it("未打开时不渲染", () => {
    const html = renderToStaticMarkup(
      <NewSkillModal
        open={false}
        projects={[]}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    );
    assert.equal(html, "");
  });
});

describe("ZIP 导入保留名新建门（CR D-1）", () => {
  let tempDir: string;
  let projectId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-skill-zip-guard-"));
    const project = await handleProjectsCreate({ name: "skill-zip-reserved" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("handler：project 域保留名（目录不存在）拒绝且中文文案，非名单名放行", async () => {
    const denied = await handleSkillsAssertCreateName({
      domain: "project",
      projectId,
      name: "agent-config",
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.error.code, "BUILTIN_SKILL_NAME_RESERVED");
      assert.match(denied.error.message, /「agent-config」为内置技能保留名/);
    }

    const allowed = await handleSkillsAssertCreateName({
      domain: "project",
      projectId,
      name: "zip-plain-skill",
    });
    assert.equal(allowed.ok, true);
  });

  it("源码契约：imported 分支在 ipcVfsZipImportBytes 之前过保留名校验", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../renderer/features/skills/NewSkillModal.tsx", import.meta.url)),
      "utf8",
    );
    const assertIdx = src.indexOf("ipcSkillsAssertCreateName({");
    const importIdx = src.indexOf("ipcVfsZipImportBytes({");
    assert.ok(assertIdx >= 0, "NewSkillModal 应调用 ipcSkillsAssertCreateName");
    assert.ok(importIdx >= 0, "NewSkillModal 应调用 ipcVfsZipImportBytes");
    assert.ok(
      assertIdx < importIdx,
      "保留名校验必须发生在 zip 落盘之前",
    );
    // 被拒时中文提示且不落盘：错误分支 return
    assert.match(src, /if \(!assertRes\.ok\) \{[\s\S]*?setError\(assertRes\.error\.message\);[\s\S]*?return;/);
  });
});

describe("SkillInfoEditModal（T-S5：编辑信息弹窗）", () => {
  const baseProps = {
    onClose: () => undefined,
    onSaved: () => undefined,
  };

  it("普通技能：渲染标题与两字段，名称框可编辑", () => {
    const html = renderToStaticMarkup(
      <SkillInfoEditModal
        open
        skillRef={{ domain: "global", name: "my-skill" }}
        currentName="my-skill"
        currentDescription="原描述"
        {...baseProps}
      />,
    );
    assert.match(html, /编辑信息/);
    assert.match(html, /技能名/);
    assert.match(html, /描述（进入技能索引）/);
    assert.doesNotMatch(html, /readonly/);
  });

  it("global 域内置技能：名称框只读且提示不可改名", () => {
    const html = renderToStaticMarkup(
      <SkillInfoEditModal
        open
        skillRef={{ domain: "global", name: "agent-config" }}
        currentName="agent-config"
        currentDescription="内置描述"
        {...baseProps}
      />,
    );
    assert.match(html, /内置技能不可改名/);
    // React DOM 会把 readOnly 序列化为 readOnly=""
    assert.match(html, /readOnly/);
  });

  it("源码契约：管理页行菜单有「编辑信息」入口，invalid 时禁用（详情页入口按用户拍板移除）", () => {
    const manageSrc = readFileSync(
      fileURLToPath(
        new URL("../renderer/features/settings/SkillsManageView.tsx", import.meta.url),
      ),
      "utf8",
    );
    assert.match(manageSrc, /"编辑信息"/);
    assert.match(manageSrc, /disabled: !menu\.valid/);
    assert.match(manageSrc, /SkillInfoEditModal/);
  });

  it("源码契约：校验消费 core validateSkillName，输入期出 reason 内联提示（MF-7）", () => {
    const modalSrc = readFileSync(
      fileURLToPath(
        new URL("../renderer/features/skills/SkillInfoEditModal.tsx", import.meta.url),
      ),
      "utf8",
    );
    // 消费链：@shared/logic/skills 再导出 core 单源，与 mobile 同口径
    assert.match(
      modalSrc,
      /import \{ BUILTIN_SKILL_NAMES, validateSkillName \} from "@shared\/logic\/skills"/,
    );
    // 输入期即出 reason（含保留名 SKILL.md / 空白全口径），点保存前拦截
    assert.match(
      modalSrc,
      /nameChanged && name\.length > 0 \? validateSkillName\(trimmedName\) : null/,
    );
    assert.match(modalSrc, /\{nameIssue\}/);
    // 本地布尔正则口径已退场：不再消费 isValidSkillNameInput
    assert.doesNotMatch(modalSrc, /isValidSkillNameInput/);
  });

  it("源码契约：提交链路有 catch 兑底（MF-11，对齐 mobile）", () => {
    const modalSrc = readFileSync(
      fileURLToPath(
        new URL("../renderer/features/skills/SkillInfoEditModal.tsx", import.meta.url),
      ),
      "utf8",
    );
    // IPC 极端失败（如 bridge 断连）时 setError 提示，不静默 unhandled rejection
    assert.match(
      modalSrc,
      /\} catch \(err\) \{[\s\S]*?setError\(err instanceof Error \? err\.message : String\(err\)\);[\s\S]*?return;[\s\S]*?\} finally \{/,
    );
    // catch 块内不调 onClose（失败不停窗，用户可重试）
    const catchBody = modalSrc.match(/\} catch \(err\) \{([\s\S]*?)\} finally \{/);
    assert.ok(catchBody != null, "应有 catch → finally 结构");
    assert.ok(!catchBody[1]!.includes("onClose"), "catch 内不应调 onClose");
  });
});

describe("NewSkillModal version 残留清理（T-S6）", () => {
  it("源码断言：无 readRes 调用、无 version: 传参与乐观锁注释", () => {
    const src = readFileSync(
      fileURLToPath(
        new URL("../renderer/features/skills/NewSkillModal.tsx", import.meta.url),
      ),
      "utf8",
    );
    // SkillsWriteRequest 无 version 字段：死参数与取版本的 read 一并清理
    expect_no_version(src);
  });
});

function expect_no_version(src: string): void {
  assert.ok(!src.includes("ipcSkillsRead"), "NewSkillModal 不应再调用 ipcSkillsRead");
  assert.ok(!src.includes("readRes"), "不应有 readRes 残留");
  assert.ok(!/\bversion\s*:/.test(src), "不应有 version: 传参残留");
  assert.ok(!src.includes("乐观锁"), "不应有过时乐观锁注释");
}
