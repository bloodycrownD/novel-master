import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CharacterCardError,
  parseCharacterCardToMdTree,
} from "@novel-master/core/vfs";
import { extractPngCharaJsonText } from "../../src/domain/character-card/logic/extract-png-chara.js";
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

describe("extract-png-chara", () => {
  it("fixture PNG（IHDR+tEXt chara+IEND）能取出 JSON 字符串", () => {
    const bytes = buildPngWithTextChara(SAMPLE_CARD);
    const jsonText = extractPngCharaJsonText(bytes);
    assert.deepEqual(JSON.parse(jsonText), SAMPLE_CARD);
  });

  it("T-C6: 仅 iTXt chara → NOT_CHARACTER_CARD，且不 JSON 回退成功", () => {
    const bytes = buildPngWithOnlyItxtChara(SAMPLE_CARD);
    assert.throws(
      () => parseCharacterCardToMdTree(bytes),
      (e: unknown) =>
        e instanceof CharacterCardError && e.code === "NOT_CHARACTER_CARD",
    );
  });

  it("T-C6: 仅 zTXt chara → NOT_CHARACTER_CARD", () => {
    const bytes = buildPngWithOnlyZtxtChara(SAMPLE_CARD);
    assert.throws(
      () => parseCharacterCardToMdTree(bytes),
      (e: unknown) =>
        e instanceof CharacterCardError && e.code === "NOT_CHARACTER_CARD",
    );
  });

  it("T-C6: 坏 PNG → NOT_CHARACTER_CARD", () => {
    assert.throws(
      () => parseCharacterCardToMdTree(buildBrokenPngBytes()),
      (e: unknown) =>
        e instanceof CharacterCardError && e.code === "NOT_CHARACTER_CARD",
    );
  });
});
