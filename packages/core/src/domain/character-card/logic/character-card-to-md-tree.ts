/**
 * 角色卡 → 相对路径 Markdown 树。
 *
 * 统一入口 `parseCharacterCardToMdTree`：string 直接按 JSON 解析；Uint8Array
 * 先看 PNG 魔数，命中只走 tEXt/chara，失败不回退 UTF-8 JSON；未命中按
 * UTF-8 JSON 解析。JSON 对象 → md 树的映射在本文件内完成。
 *
 * @module domain/character-card/logic/character-card-to-md-tree
 */

import { base64ToBytes } from "@/common/base64.js";
import { isRecord } from "@/common/guards.js";
import { parseJsonText } from "@/common/json.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { stringifyText } from "@/infra/serialization/stringify-text.js";
import type { MdTree } from "../model/character-card.js";

const SPEC_V2 = "chara_card_v2";
// eslint-disable-next-line no-control-regex -- 故意剔除控制字符（文件名非法字符表的核心部分）
const ILLEGAL_CHARS = /[/\\:*?"<>|\x00-\x1f]/g;

/** PNG 文件签名（8 字节）。 */
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHUNK_TYPE_TEXT = "tEXt";
const CHUNK_TYPE_IEND = "IEND";
const CHARA_KEYWORD = "chara";

function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function characterCardJsonToMdTree(card: unknown): Result<MdTree, AppError> {
  if (!isRecord(card)) {
    return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
  }
  const spec = card["spec"];
  const dataRaw = card["data"];
  const data = isRecord(dataRaw) ? dataRaw : undefined;
  const recognizable = spec === SPEC_V2 || data != null || typeof card["description"] === "string" || typeof card["first_mes"] === "string" || isRecord(card["character_book"]);
  if (!recognizable) {
    if (typeof spec === "string" && spec.length > 0) {
      return Result.err(new AppError("VFS_CHARACTER_CARD_UNSUPPORTED_SPEC", `不支持的角色卡规格: ${spec}`));
    }
    return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
  }

  const descriptionRaw = data?.["description"];
  const description = typeof descriptionRaw === "string" ? descriptionRaw : typeof card["description"] === "string" ? card["description"] : "";
  const firstMesRaw = data?.["first_mes"];
  const firstMes = typeof firstMesRaw === "string" ? firstMesRaw : typeof card["first_mes"] === "string" ? card["first_mes"] : "";
  const greetingsRaw = data?.["alternate_greetings"] ?? card["alternate_greetings"];
  const alternateGreetings = Array.isArray(greetingsRaw) ? greetingsRaw.filter((item): item is string => typeof item === "string") : [];
  const bookRaw = data?.["character_book"] ?? card["character_book"];
  const book = isRecord(bookRaw) ? bookRaw : undefined;
  const entriesRaw = book?.["entries"];
  const entries = Array.isArray(entriesRaw) ? entriesRaw : [];

  const tree = new Map<string, string>();
  tree.set("角色描述.md", description);
  const openings = [firstMes, ...alternateGreetings].filter((text) => text.length > 0);
  for (let i = 0; i < openings.length; i++) {
    // 三位数字对齐：开场001、开场002 … 开场010
    tree.set(`开场/开场${String(i + 1).padStart(3, "0")}.md`, openings[i]!);
  }

  const usedNames = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isRecord(entry)) {
      continue;
    }
    const rawKeys = entry["keys"];
    const keys = Array.isArray(rawKeys) ? rawKeys.filter((item): item is string => typeof item === "string") : [];
    const comment = typeof entry["comment"] === "string" ? entry["comment"].trim() : "";
    const firstKey = keys.find((key) => key.trim().length > 0)?.trim();
    const sanitizedComment = comment.replace(ILLEGAL_CHARS, "_").replace(/^[.\s]+|[.\s]+$/g, "");
    const sanitizedKey = firstKey == null ? "" : firstKey.replace(ILLEGAL_CHARS, "_").replace(/^[.\s]+|[.\s]+$/g, "");
    const baseName = sanitizedComment || sanitizedKey || `条目${i + 1}`;
    let fileName = `${baseName}.md`;
    for (let n = 2; usedNames.has(fileName); n++) {
      fileName = `${baseName}-${n}.md`;
    }
    usedNames.add(fileName);
    const content = typeof entry["content"] === "string" ? entry["content"] : "";
    const fmBody = stringifyText({keywords: [...keys]}, "yaml").trimEnd();
    tree.set(`世界书/${fileName}`, `---\n${fmBody}\n---\n${content}`);
  }
  return Result.ok(tree);
}

/**
 * 将角色卡字节或 JSON 文本解析为相对路径 md 树。
 */
export function parseCharacterCardToMdTree(input: Uint8Array | string): Result<MdTree, AppError> {
  if (typeof input === "string") {
    const parsed = parseJsonText(input);
    if (!parsed.ok) {
      return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
    }
    return characterCardJsonToMdTree(parsed.value);
  }
  if (input.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => input[index] === byte)) {
    // PNG 魔数命中后只走 tEXt/chara；失败不得再当 UTF-8 JSON 回退
    let offset = PNG_SIGNATURE.length;
    let charaText: string | undefined;
    while (offset + 12 <= input.length) {
      const length = ((input[offset]! << 24) | (input[offset + 1]! << 16) | (input[offset + 2]! << 8) | input[offset + 3]!) >>> 0;
      const typeStart = offset + 4;
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const crcEnd = dataEnd + 4;
      if (crcEnd > input.length) {
        return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
      }

      const type = decodeLatin1(input.subarray(typeStart, typeStart + 4));
      if (type === CHUNK_TYPE_IEND) {
        break;
      }
      if (type === CHUNK_TYPE_TEXT) {
        const data = input.subarray(dataStart, dataEnd);
        const nullIndex = data.indexOf(0);
        if (nullIndex > 0 && decodeLatin1(data.subarray(0, nullIndex)) === CHARA_KEYWORD) {
          charaText = decodeLatin1(data.subarray(nullIndex + 1));
        }
      }
      offset = crcEnd;
    }
    if (charaText == null || charaText.length === 0) {
      return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
    }
    let jsonText: string;
    try {
      jsonText = new TextDecoder("utf-8").decode(base64ToBytes(charaText));
    } catch {
      return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
    }
    const parsed = parseJsonText(jsonText);
    if (!parsed.ok) {
      return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
    }
    return characterCardJsonToMdTree(parsed.value);
  }
  const payload = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(payload);
  } catch {
    return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
  }
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    return Result.err(new AppError("VFS_CHARACTER_CARD_UNRECOGNIZED", "无法识别为角色卡"));
  }
  return characterCardJsonToMdTree(parsed.value);
}
