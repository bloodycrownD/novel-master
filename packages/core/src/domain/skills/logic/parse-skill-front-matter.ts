/**
 * SKILL.md front matter 解析（FrontMatter.splitMarkdown + parseText("yaml")）。
 *
 * 解析失败不抛错，产出有效性标记与无效原因——无效技能保留在清单里，
 * 管理界面展示原因并可修复。
 *
 * @module domain/skills/logic/parse-skill-front-matter
 */

import { FrontMatter } from "@/common/front-matter.js";
import { Coerce } from "@/common/coerce.js";
import { Guards } from "@/common/guards.js";
import type { MessageLike } from "@/common/i18n.js";
import { LocalizedMessage } from "@/i18n/localized-message.js";
import { SerializationParseText } from "@/common/serialization/parse-text.js";
import { skillFrontMatterSchema } from "../model/skill.schema.js";

/** front matter 解析结果（含有效性标记与无效原因；invalidReason 供 UI 翻译）。 */
interface ParsedSkillFrontMatter {
    readonly valid: boolean;
    readonly invalidReason?: MessageLike;
    readonly name: string | null;
    readonly description: string | null;
}

export const SkillFrontMatter = {
    /** 尽力从原始映射里提取字段（无效时也保留可展示的部分元数据）。 */
    pickStringField(raw: unknown, key: string): string | null {
        if (!Guards.isRecord(raw)) {
            return null;
        }
        const value = Coerce.strictText(raw[key]);
        return value != null && value.length > 0 ? value : null;
    },

    /**
   * 解析 SKILL.md 全文，产出 front matter 元数据与有效性。
   *
   * 有效 = front matter 存在、YAML 可解析、且通过 skillFrontMatterSchema
   * （name 与 description 非空，无未知键）。
   */
    parse(source: string): ParsedSkillFrontMatter {
        const split = FrontMatter.splitMarkdown(source);
        if (split.frontMatterLines === null) {
            return {
                valid: false,
                invalidReason: { key: "error.skill.front_matter_missing" },
                name: null,
                description: null,
            };
        }

        // parseText 四期起沿 Result 回传解析失败（不再 throw）；Err.error 即原
        // AppError，message 口径与旧 catch 分支一致。
        const text = SerializationParseText.parse(split.frontMatterLines.join("\n"), "yaml");
        if (!text.ok) {
            const message = text.error.message;
            return {
                valid: false,
                invalidReason: { key: "error.skill.front_matter_unparsable", params: { message } },
                name: null,
                description: null,
            };
        }
        const raw: unknown = text.value;

        const parsed = skillFrontMatterSchema.safeParse(raw);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            return {
                valid: false,
                invalidReason: { key: "error.skill.front_matter_field_invalid", params: { message: LocalizedMessage.paramOf(issue?.message ?? "unknown") } },
                name: SkillFrontMatter.pickStringField(raw, "name"),
                description: SkillFrontMatter.pickStringField(raw, "description"),
            };
        }

        return {
            valid: true,
            name: parsed.data.name,
            description: parsed.data.description,
        };
    },
} as const;
