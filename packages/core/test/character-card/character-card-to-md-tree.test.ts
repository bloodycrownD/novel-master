import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CharacterCardError,
  characterCardJsonToMdTree,
  parseCharacterCardToMdTree,
} from "@novel-master/core/vfs";
import { buildPngWithTextChara } from "./helpers/png-chara-fixture.js";

function treeKeys(tree: ReadonlyMap<string, string>): string[] {
  return [...tree.keys()].sort();
}

describe("character-card-to-md-tree", () => {
  it("T-C1: 仅 description → 仅有 角色描述.md，无开场/世界书", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: { description: "只有描述" },
    });
    assert.deepEqual(treeKeys(tree), ["角色描述.md"]);
    assert.equal(tree.get("角色描述.md"), "只有描述");
  });

  it("T-C2: first_mes + 2 alternate → 开场001..003 顺序正确", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        first_mes: "主开场",
        alternate_greetings: ["备选A", "备选B"],
      },
    });
    assert.equal(tree.get("开场/开场001.md"), "主开场");
    assert.equal(tree.get("开场/开场002.md"), "备选A");
    assert.equal(tree.get("开场/开场003.md"), "备选B");
  });

  it("开场编号三位对齐：第 10 条为开场010", () => {
    const greets = Array.from({ length: 9 }, (_, i) => `备选${i + 1}`);
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        first_mes: "主",
        alternate_greetings: greets,
      },
    });
    assert.equal(tree.get("开场/开场001.md"), "主");
    assert.equal(tree.get("开场/开场010.md"), "备选9");
  });

  it("T-C3: 两条 comment 均为「原神」→ 原神.md 与 原神-2.md", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        character_book: {
          entries: [
            { comment: "原神", content: "正文1", keys: [] },
            { comment: "原神", content: "正文2", keys: [] },
          ],
        },
      },
    });
    assert.equal(tree.get("世界书/原神.md")?.endsWith("正文1"), true);
    assert.equal(tree.get("世界书/原神-2.md")?.endsWith("正文2"), true);
  });

  it("T-C4: keys 写入 keywords FM，正文=content", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        character_book: {
          entries: [
            {
              comment: "词条",
              keys: ["原神", "原批"],
              content: "条目正文",
            },
          ],
        },
      },
    });
    const md = tree.get("世界书/词条.md")!;
    assert.match(md, /^---\n/);
    assert.match(md, /keywords:\n {2}- 原神\n {2}- 原批\n/);
    assert.ok(md.includes("---\n条目正文"));
  });

  it("T-C5: enabled:false 条目仍生成文件", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        character_book: {
          entries: [
            {
              comment: "关闭项",
              enabled: false,
              keys: ["k"],
              content: "仍导入",
            },
          ],
        },
      },
    });
    assert.ok(tree.has("世界书/关闭项.md"));
    assert.ok(tree.get("世界书/关闭项.md")!.includes("仍导入"));
  });

  it("T-C13: comment/keys 皆空且位于 entries[2] → 世界书/条目3.md", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        character_book: {
          entries: [
            { comment: "a", content: "1", keys: [] },
            { comment: "b", content: "2", keys: [] },
            { comment: "", keys: [], content: "第三条" },
          ],
        },
      },
    });
    assert.ok(tree.has("世界书/条目3.md"));
    assert.ok(tree.get("世界书/条目3.md")!.includes("第三条"));
  });

  it("T-C14: 无 keys → keywords: []；content 缺失 → 正文空", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        character_book: {
          entries: [{ comment: "空键" }],
        },
      },
    });
    const md = tree.get("世界书/空键.md")!;
    assert.match(md, /keywords: \[\]\n/);
    assert.equal(md.endsWith("---\n"), true);
  });

  it("T-C6: 非卡 JSON → NOT_CHARACTER_CARD", () => {
    assert.throws(
      () => characterCardJsonToMdTree({ foo: 1 }),
      (e: unknown) =>
        e instanceof CharacterCardError && e.code === "NOT_CHARACTER_CARD",
    );
  });

  it("UTF-8 BOM JSON 可解析", () => {
    const withBom = `\uFEFF${JSON.stringify({
      spec: "chara_card_v2",
      data: { description: "bom" },
    })}`;
    const tree = parseCharacterCardToMdTree(withBom);
    assert.equal(tree.get("角色描述.md"), "bom");
  });

  it("T-C16: fixture PNG 经 parseCharacterCardToMdTree 成功", () => {
    const bytes = buildPngWithTextChara({
      spec: "chara_card_v2",
      data: { description: "来自PNG" },
    });
    const tree = parseCharacterCardToMdTree(bytes);
    assert.equal(tree.get("角色描述.md"), "来自PNG");
  });

  it("无有效世界书（entries 非数组 / 空）不创建世界书/", () => {
    const empty = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: { description: "d", character_book: { entries: [] } },
    });
    assert.ok([...empty.keys()].every((k) => !k.startsWith("世界书/")));

    const missing = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: { description: "d", character_book: { entries: "nope" } },
    });
    assert.ok([...missing.keys()].every((k) => !k.startsWith("世界书/")));
  });

  it("非对象 entries 元素跳过，条目序号仍按原下标", () => {
    const tree = characterCardJsonToMdTree({
      spec: "chara_card_v2",
      data: {
        description: "d",
        character_book: {
          entries: [null, "x", { comment: "", keys: [], content: "对象" }],
        },
      },
    });
    assert.equal(tree.has("世界书/条目1.md"), false);
    assert.equal(tree.has("世界书/条目2.md"), false);
    assert.ok(tree.has("世界书/条目3.md"));
  });
});
