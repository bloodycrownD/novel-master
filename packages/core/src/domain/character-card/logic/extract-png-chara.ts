/**
 * 从 PNG 字节中提取 SillyTavern `tEXt`/`chara` 元数据。
 *
 * 仅识别 `tEXt`；`iTXt` / `zTXt` 即使 keyword 为 `chara` 也视为无法识别。
 *
 * @module domain/character-card/logic/extract-png-chara
 */

import { characterCardError } from "@/errors/character-card-errors.js";

/** PNG 文件签名（8 字节）。 */
export const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const CHUNK_TYPE_TEXT = "tEXt";
const CHUNK_TYPE_IEND = "IEND";
const CHARA_KEYWORD = "chara";

/**
 * 判断字节是否以 PNG 魔数开头。
 */
export function isPngMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) {
    return false;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/**
 * 扫描 PNG chunk，取出 keyword=`chara` 的 `tEXt` 正文（Base64 字符串）。
 *
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError} `NOT_CHARACTER_CARD`
 */
export function extractPngCharaBase64(bytes: Uint8Array): string {
  if (!isPngMagic(bytes)) {
    throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
  }

  let offset = PNG_SIGNATURE.length;
  let charaText: string | undefined;

  while (offset + 12 <= bytes.length) {
    const length = readUInt32BE(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > bytes.length || length < 0) {
      throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
    }

    const type = decodeLatin1(bytes.subarray(typeStart, typeStart + 4));
    if (type === CHUNK_TYPE_IEND) {
      break;
    }

    if (type === CHUNK_TYPE_TEXT) {
      const data = bytes.subarray(dataStart, dataEnd);
      let nullIndex = -1;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) {
          nullIndex = i;
          break;
        }
      }
      if (nullIndex > 0) {
        const keyword = decodeLatin1(data.subarray(0, nullIndex));
        if (keyword === CHARA_KEYWORD) {
          charaText = decodeLatin1(data.subarray(nullIndex + 1));
        }
      }
    }

    offset = crcEnd;
  }

  if (charaText == null || charaText.length === 0) {
    throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
  }
  return charaText;
}

/**
 * 从 PNG `tEXt`/`chara` 解码出 JSON 文本（UTF-8）。
 *
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError} `NOT_CHARACTER_CARD`
 */
export function extractPngCharaJsonText(bytes: Uint8Array): string {
  const b64 = extractPngCharaBase64(bytes);
  let jsonBytes: Uint8Array;
  try {
    const binary = atob(b64);
    jsonBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      jsonBytes[i] = binary.charCodeAt(i);
    }
  } catch {
    throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
  }
  try {
    return new TextDecoder("utf-8").decode(jsonBytes);
  } catch {
    throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
  }
}
