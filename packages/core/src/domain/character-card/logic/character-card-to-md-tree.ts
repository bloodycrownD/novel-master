/**
 * 规范化角色卡 → 相对路径 Markdown 树。
 *
 * @module domain/character-card/logic/character-card-to-md-tree
 */

import { stringifyText } from "@/infra/serialization/stringify-text.js";
import type {
  MdTree,
  NormalizedCharacterCardData,
} from "../model/character-card.js";
import { normalizeCharacterCardJson } from "./parse-character-card-json.js";
import { sanitizeEntryFilename } from "./sanitize-entry-filename.js";

function isNonEmptyText(value: string): boolean {
  return value.length > 0;
}

function collectOpenings(card: NormalizedCharacterCardData): string[] {
  const openings: string[] = [];
  if (isNonEmptyText(card.firstMes)) {
    openings.push(card.firstMes);
  }
  for (const greeting of card.alternateGreetings) {
    if (isNonEmptyText(greeting)) {
      openings.push(greeting);
    }
  }
  return openings;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readKeys(entry: Record<string, unknown>): string[] {
  const raw = entry["keys"];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}

function firstNonEmptyKey(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const trimmed = key.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function resolveEntryBaseName(
  entry: Record<string, unknown>,
  oneBasedIndex: number,
): string {
  const commentRaw = entry["comment"];
  if (typeof commentRaw === "string") {
    const sanitized = sanitizeEntryFilename(commentRaw.trim());
    if (sanitized != null) {
      return sanitized;
    }
  }
  const keys = readKeys(entry);
  const firstKey = firstNonEmptyKey(keys);
  if (firstKey != null) {
    const sanitized = sanitizeEntryFilename(firstKey);
    if (sanitized != null) {
      return sanitized;
    }
  }
  return `条目${oneBasedIndex}`;
}

function allocateUniqueName(
  baseName: string,
  used: Set<string>,
): string {
  let candidate = `${baseName}.md`;
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let n = 2;
  while (used.has(`${baseName}-${n}.md`)) {
    n += 1;
  }
  candidate = `${baseName}-${n}.md`;
  used.add(candidate);
  return candidate;
}

function buildWorldbookMarkdown(
  keywords: readonly string[],
  content: string,
): string {
  const fmBody = stringifyText({ keywords: [...keywords] }, "yaml").trimEnd();
  return `---\n${fmBody}\n---\n${content}`;
}

/**
 * 将未知角色卡 JSON 映射为相对路径 md 树。
 */
export function characterCardJsonToMdTree(card: unknown): MdTree {
  return normalizedCardToMdTree(normalizeCharacterCardJson(card));
}

/**
 * 将已规范化字段映射为相对路径 md 树。
 */
export function normalizedCardToMdTree(
  card: NormalizedCharacterCardData,
): MdTree {
  const tree = new Map<string, string>();
  tree.set("角色描述.md", card.description);

  const openings = collectOpenings(card);
  for (let i = 0; i < openings.length; i++) {
    // 三位数字对齐：开场001、开场002 … 开场010
    const index = String(i + 1).padStart(3, "0");
    tree.set(`开场/开场${index}.md`, openings[i]!);
  }

  const entries = card.characterBookEntries;
  if (entries.length === 0) {
    return tree;
  }

  const usedNames = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const entry = asRecord(entries[i]);
    if (entry == null) {
      continue;
    }
    const baseName = resolveEntryBaseName(entry, i + 1);
    const fileName = allocateUniqueName(baseName, usedNames);
    const keys = readKeys(entry);
    const contentRaw = entry["content"];
    const content = typeof contentRaw === "string" ? contentRaw : "";
    tree.set(`世界书/${fileName}`, buildWorldbookMarkdown(keys, content));
  }

  return tree;
}
