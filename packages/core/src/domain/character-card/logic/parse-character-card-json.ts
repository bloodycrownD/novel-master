/**
 * 角色卡 JSON 解析与 V2 字段规范化。
 *
 * @module domain/character-card/logic/parse-character-card-json
 */

import { characterCardError } from "@/errors/character-card-errors.js";
import type { NormalizedCharacterCardData } from "../model/character-card.js";

const SPEC_V2 = "chara_card_v2";

/**
 * 剥离 UTF-8 BOM（若存在）。
 */
export function stripUtf8BomText(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

/**
 * 将 UTF-8 文本解析为 JSON 值（可剥 BOM）。
 *
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError} `NOT_CHARACTER_CARD`
 */
export function parseCharacterCardJsonText(text: string): unknown {
  const stripped = stripUtf8BomText(text);
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
  }
}

/**
 * 将 UTF-8 字节解析为 JSON 值（可剥 BOM）。
 *
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError} `NOT_CHARACTER_CARD`
 */
export function parseCharacterCardJsonBytes(bytes: Uint8Array): unknown {
  let payload = bytes;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    payload = bytes.subarray(3);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(payload);
  } catch {
    throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
  }
  return parseCharacterCardJsonText(text);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readStringField(
  primary: Record<string, unknown> | undefined,
  fallback: Record<string, unknown>,
  key: string,
): string {
  const fromPrimary = primary?.[key];
  if (typeof fromPrimary === "string") {
    return fromPrimary;
  }
  const fromFallback = fallback[key];
  if (typeof fromFallback === "string") {
    return fromFallback;
  }
  return "";
}

function readAlternateGreetings(
  primary: Record<string, unknown> | undefined,
  fallback: Record<string, unknown>,
): readonly string[] {
  const raw =
    primary?.["alternate_greetings"] ?? fallback["alternate_greetings"];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}

function readCharacterBookEntries(
  primary: Record<string, unknown> | undefined,
  fallback: Record<string, unknown>,
): readonly unknown[] {
  const bookRaw = primary?.["character_book"] ?? fallback["character_book"];
  const book = asRecord(bookRaw);
  if (book == null) {
    return [];
  }
  const entries = book["entries"];
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries;
}

/**
 * 判断 JSON 是否可识别为本期角色卡形态。
 */
function assertRecognizableCard(root: Record<string, unknown>): void {
  const spec = root["spec"];
  const data = asRecord(root["data"]);
  if (spec === SPEC_V2) {
    return;
  }
  if (data != null) {
    return;
  }
  if (
    typeof root["description"] === "string" ||
    typeof root["first_mes"] === "string" ||
    asRecord(root["character_book"]) != null
  ) {
    return;
  }
  if (typeof spec === "string" && spec.length > 0) {
    throw characterCardError(
      "UNSUPPORTED_SPEC",
      `不支持的角色卡规格: ${spec}`,
    );
  }
  throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
}

/**
 * 将未知 JSON 规范化为可映射字段。
 *
 * @throws {import("@/errors/character-card-errors.js").CharacterCardError}
 */
export function normalizeCharacterCardJson(
  raw: unknown,
): NormalizedCharacterCardData {
  const root = asRecord(raw);
  if (root == null) {
    throw characterCardError("NOT_CHARACTER_CARD", "无法识别为角色卡");
  }
  assertRecognizableCard(root);

  const data = asRecord(root["data"]);
  return {
    description: readStringField(data, root, "description"),
    firstMes: readStringField(data, root, "first_mes"),
    alternateGreetings: readAlternateGreetings(data, root),
    characterBookEntries: readCharacterBookEntries(data, root),
  };
}
