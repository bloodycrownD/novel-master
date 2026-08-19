/**
 * previewSkillZip：技能 zip 预检（新建弹窗预填）。
 *
 * - 根 SKILL.md 存在：提取 name/description 与文件数；
 * - front matter 无效：字段可空但 skillMd 保留（调用方可补全后重建）；
 * - 根无 SKILL.md：skillMd=null（调用方报「zip 根缺少 SKILL.md」）；
 * - 目录标记条目不计入 fileCount。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildVfsZip } from "../../src/domain/vfs/logic/vfs-zip-build.js";
import { previewSkillZip } from "../../src/domain/skills/logic/preview-skill-zip.js";

function zipOf(files: Record<string, string>, dirs: string[] = []): Uint8Array {
  return buildVfsZip(new Map(Object.entries(files)), dirs);
}

describe("previewSkillZip", () => {
  it("根含 SKILL.md：提取 front matter 元数据与文件数（目录条目不计）", () => {
    const bytes = zipOf(
      {
        "SKILL.md": "---\nname: demo\ndescription: 演示技能\n---\n# 正文",
        "references/x.md": "辅助",
      },
      ["references"],
    );
    const preview = previewSkillZip(bytes);
    assert.equal(preview.name, "demo");
    assert.equal(preview.description, "演示技能");
    assert.equal(preview.valid, true);
    assert.equal(preview.fileCount, 2);
    assert.match(preview.skillMd ?? "", /# 正文/);
  });

  it("front matter 无效：valid=false，name/description 可空但 skillMd 保留", () => {
    const bytes = zipOf({"SKILL.md": "# 没有 front matter"});
    const preview = previewSkillZip(bytes);
    assert.equal(preview.valid, false);
    assert.equal(preview.name, null);
    assert.equal(preview.description, null);
    assert.match(preview.skillMd ?? "", /没有 front matter/);
    assert.equal(preview.fileCount, 1);
  });

  it("zip 根缺少 SKILL.md：skillMd=null（嵌套目录不算根）", () => {
    const bytes = zipOf({"demo/SKILL.md": "---\nname: demo\n---\n"});
    const preview = previewSkillZip(bytes);
    assert.equal(preview.skillMd, null);
    assert.equal(preview.name, null);
    assert.equal(preview.fileCount, 1);
  });

  it("description 含冒号等特殊字符可正常提取（YAML 双引号标量）", () => {
    const bytes = zipOf({
      "SKILL.md": '---\nname: demo\ndescription: "含: 冒号 与 引号"\n---\n',
    });
    const preview = previewSkillZip(bytes);
    assert.equal(preview.description, "含: 冒号 与 引号");
  });
});
