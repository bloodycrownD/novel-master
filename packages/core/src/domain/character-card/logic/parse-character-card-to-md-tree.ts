/**
 * 角色卡输入判别：string→JSON；Uint8Array 先 PNG 魔数再 JSON（PNG 失败不回退）。
 *
 * @module domain/character-card/logic/parse-character-card-to-md-tree
 */

import type { MdTree } from "../model/character-card.js";
import { characterCardJsonToMdTree } from "./character-card-to-md-tree.js";
import {
  extractPngCharaJsonText,
  isPngMagic,
} from "./extract-png-chara.js";
import {
  parseCharacterCardJsonBytes,
  parseCharacterCardJsonText,
} from "./parse-character-card-json.js";

/**
 * 将角色卡字节或 JSON 文本解析为相对路径 md 树。
 *
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError}
 */
export function parseCharacterCardToMdTree(
  input: Uint8Array | string,
): MdTree {
  if (typeof input === "string") {
    return characterCardJsonToMdTree(parseCharacterCardJsonText(input));
  }

  if (isPngMagic(input)) {
    // PNG 魔数命中后只走 tEXt/chara；失败不得再当 UTF-8 JSON 回退
    const jsonText = extractPngCharaJsonText(input);
    return characterCardJsonToMdTree(parseCharacterCardJsonText(jsonText));
  }

  return characterCardJsonToMdTree(parseCharacterCardJsonBytes(input));
}
