import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCharacterCardToMdTree } from "../../src/domain/character-card/logic/character-card-to-md-tree.js";
import {
  buildBrokenPngBytes,
  buildPngWithOnlyItxtChara,
  buildPngWithOnlyZtxtChara,
  buildPngWithTextChara,
} from "./helpers/png-chara-fixture.js";

const SAMPLE_CARD = {
  spec: "chara_card_v2",
  data: {
    description: "角色设定正文",
    first_mes: "你好",
  },
};

function expectUnrecognized(result: ReturnType<typeof parseCharacterCardToMdTree>): void {
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.error.key, "VFS_CHARACTER_CARD_UNRECOGNIZED");
}

describe("parseCharacterCardToMdTree PNG", () => {
  it("fixture PNG（IHDR+tEXt chara+IEND）经 parseCharacterCardToMdTree 取出角色描述与开场", () => {
    const result = parseCharacterCardToMdTree(buildPngWithTextChara(SAMPLE_CARD));
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.value.get("角色描述.md"), "角色设定正文");
    assert.equal(result.value.get("开场/开场001.md"), "你好");
  });

  it("T-C6: 仅 iTXt chara → VFS_CHARACTER_CARD_UNRECOGNIZED，且不 JSON 回退成功", () => {
    expectUnrecognized(parseCharacterCardToMdTree(buildPngWithOnlyItxtChara(SAMPLE_CARD)));
  });

  it("T-C6: 仅 zTXt chara → VFS_CHARACTER_CARD_UNRECOGNIZED", () => {
    expectUnrecognized(parseCharacterCardToMdTree(buildPngWithOnlyZtxtChara(SAMPLE_CARD)));
  });

  it("T-C6: 坏 PNG → VFS_CHARACTER_CARD_UNRECOGNIZED", () => {
    expectUnrecognized(parseCharacterCardToMdTree(buildBrokenPngBytes()));
  });
});
