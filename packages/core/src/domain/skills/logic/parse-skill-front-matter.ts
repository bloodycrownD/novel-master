/**
 * SKILL.md front matter 解析（splitMarkdownFrontMatter + parseText("yaml")）。
 *
 * 解析失败不抛错，产出有效性标记与无效原因——无效技能保留在清单里，
 * 管理界面展示原因并可修复。
 *
 * @module domain/skills/logic/parse-skill-front-matter
 */

import { splitMarkdownFrontMatter } from "@/domain/workplace/logic/front-matter.js";
import { parseText } from "@/infra/serialization/parse-text.js";
import { skillFrontMatterSchema } from "../model/skill.schema.js";

/** front matter 解析结果（含有效性标记与无效原因）。 */
export interface ParsedSkillFrontMatter {
  readonly valid: boolean;
  readonly invalidReason?: string;
  readonly name: string | null;
  readonly description: string | null;
}

/** 尽力从原始映射里提取字段（无效时也保留可展示的部分元数据）。 */
function pickStringField(raw: unknown, key: string): string | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 解析 SKILL.md 全文，产出 front matter 元数据与有效性。
 *
 * 有效 = front matter 存在、YAML 可解析、且通过 skillFrontMatterSchema
 * （name 与 description 非空，无未知键）。
 */
export function parseSkillFrontMatter(source: string): ParsedSkillFrontMatter {
  const split = splitMarkdownFrontMatter(source);
  if (split.frontMatterLines === null) {
    return {
      valid: false,
      invalidReason: "缺少 front matter（需以 --- 包裹并含 name 与 description）",
      name: null,
      description: null,
    };
  }

  let raw: unknown;
  try {
    raw = parseText(split.frontMatterLines.join("\n"), "yaml");
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid YAML";
    return {
      valid: false,
      invalidReason: `front matter 不可解析：${message}`,
      name: null,
      description: null,
    };
  }

  const parsed = skillFrontMatterSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      valid: false,
      invalidReason: `front matter 字段不合法：${issue?.message ?? "未知错误"}`,
      name: pickStringField(raw, "name"),
      description: pickStringField(raw, "description"),
    };
  }

  return {
    valid: true,
    name: parsed.data.name,
    description: parsed.data.description,
  };
}
