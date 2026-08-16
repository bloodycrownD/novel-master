/**
 * 发送时扫描正文手输 `$技能名` → `source:attach` + `action:skillAttach` 附件
 * （正文 token 原样保留，与 `@path` 扫描同构）。
 *
 * token 前导边界 `(?<!\S)`（行首/空格/制表符后），避免误吞 `a$b`、`$$b` 等
 * 正文片段；name 在扫描字符类（禁空白/`$`/`/`/`@`）之上再过 SKILL_NAME_PATTERN
 * 校验，非法形态（如 `$..x`）视作正文不落库。附件无 `path`，专用字段
 * `skillName` 为解析与展示唯一依据；去重键 `skill:{name}` 与提示词 seen key
 * 同形（与路径 seen 同集合、不同命名空间）。
 *
 * @module domain/chat/logic/scan-skill-attachments
 */

import { SKILL_NAME_PATTERN } from "@/domain/skills/model/skill-name.js";
import type { MessageAttachment } from "../model/message-attachment.schema.js";
import { mergeAttachmentsByPath } from "./scan-at-path-attachments.js";

/**
 * 合法 `$技能名` token。`$` 在字符类外是行尾锚，必须转义（不转义恒匹配空）；
 * name 禁空白、`$`、`/`、`@`（`/`、`@` 停扫避免与路径 token 相互吞噬）。
 */
const SKILL_TOKEN_RE = /(?<!\S)\$([^\s$/@]+)/g;

/** 技能 seen / 去重 key：`skill:{name}`（与路径 seen 同集合的独立命名空间）。 */
export function skillSeenKey(name: string): string {
  return `skill:${name}`;
}

/** 从正文扫描 `$技能名` token，生成 skillAttach 附件（按 skillName 去重）。 */
export function scanSkillAttachments(text: string): MessageAttachment[] {
  if (text === "") {
    return [];
  }
  const seen = new Set<string>();
  const out: MessageAttachment[] = [];
  SKILL_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SKILL_TOKEN_RE.exec(text)) != null) {
    const name = match[1]!;
    // 扫描字符集比技能名规则宽（如允许首字符 `.`）：再过 SKILL_NAME_PATTERN，
    // 非法形态视作正文片段跳过
    if (!SKILL_NAME_PATTERN.test(name)) {
      continue;
    }
    const key = skillSeenKey(name);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      name,
      source: "attach",
      type: "text",
      content: null,
      skillName: name,
      action: "skillAttach",
    });
  }
  return out;
}

/**
 * 合并已有附件与 `$技能名` 扫描结果；按 `skill:{name}` 去重（先保留已有），
 * 供发送编排在 `@path` 扫描合并之上叠加调用。
 */
export function mergeAttachmentsWithScannedSkills(
  text: string,
  existing: readonly MessageAttachment[],
): MessageAttachment[] {
  return mergeAttachmentsByPath(existing, scanSkillAttachments(text));
}
