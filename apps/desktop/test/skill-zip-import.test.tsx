/**
 * 技能 ZIP 导入并入新建弹窗（desktop 同步 mobile 9a04dee）：
 * - 主进程 zipImportBytes：字节直写 /meta/skills/{name}（SKILL.md + 附属文件），
 *   非 zip 字节拒绝；global/project 两域各自落盘。
 * - withFrontMatterValues：表单值重写 front matter（保留其余键与正文）。
 * - NewSkillModal：默认渲染「从 ZIP 导入…」入口。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildVfsZip } from "@novel-master/core/vfs";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import {
  handleSkillsList,
  handleSkillsRead,
} from "../src/main/ipc/handlers/skills.js";
import { handleVfsZipImportBytes } from "../src/main/ipc/handlers/vfs.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";
import { withFrontMatterValues } from "@/features/skills/skill-ui";
import { NewSkillModal } from "@/features/skills/NewSkillModal";

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
      workspaceScope: "session",
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
      workspaceScope: "global",
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

  it("非 zip 字节拒绝（VfsZipError 落 name 兜底路径，message 含 not a ZIP）", async () => {
    const res = await handleVfsZipImportBytes({
      workspaceScope: "global",
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

describe("withFrontMatterValues（表单值重写 front matter）", () => {
  it("替换既有 name/description，保留其余键与正文", () => {
    const source =
      "---\nname: old-name\ndescription: 旧描述\nextra: 保留\n---\n\n正文。\n";
    const out = withFrontMatterValues(source, "new-name", "含: 冒号的描述");
    assert.match(out, /^---\nname: "new-name"\ndescription: "含: 冒号的描述"\nextra: 保留\n---\n\n正文。\n$/);
  });

  it("缺失 name/description 键时补全", () => {
    const source = "---\nname: old\n---\n\n正文。\n";
    const out = withFrontMatterValues(source, "old", "新描述");
    assert.match(out, /description: "新描述"/);
    assert.match(out, /name: "old"/);
  });

  it("无 front matter 块时前置补一个", () => {
    const out = withFrontMatterValues("只有正文。\n", "n", "d");
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
