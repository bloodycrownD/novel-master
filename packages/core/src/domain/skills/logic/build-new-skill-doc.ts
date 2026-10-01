/**
 * 新建技能的 SKILL.md 模板（front matter + 标题 + 引导说明）——双端单源。
 *
 * 病症背景：此前 desktop 与 mobile 各自手拼一份模板，desktop 端**裸插值**、
 * mobile 端用 `JSON.stringify` 转义。于是 description 里带**半角** `": "`
 * （如「用途: 调研」）时，desktop 端产出的 YAML 被解析成嵌套 map，
 * `parseSkillFrontMatter` 返回 `valid:false`，技能**创建后立即显示为「无效技能」**；
 * 同一输入 mobile 端正常。（⚠️ 必须是半角冒号 + 后跟空格；全角 `：` 不复现。
 * ⚠️ 也不是抛错——解析失败走 `valid:false` + `invalidReason`，对外不抛。）
 *
 * 本模块把两端收敛成一份实现，转义口径统一走 {@link yamlScalar}。
 * 正文引导文案两端原本不同，为避免对任一端造成可见的行为回退，
 * 保留两个正文变体（`variant`），**只有 front matter 的转义是单源的**。
 *
 * @module domain/skills/logic/build-new-skill-doc
 */

import { yamlScalar } from "./yaml-scalar.js";

/**
 * 模板正文变体：
 * - `desktop`：标题 + 描述 + 一行 HTML 注释（引导写辅助文件），desktop 端现行文案；
 * - `mobile`：标题 + 描述 + `## 使用说明` 两条要点，mobile 端现行文案。
 *
 * 两者产出的 front matter 完全一致（同一份转义实现），只有正文不同。
 */
export type SkillDocBodyVariant = "desktop" | "mobile";

/** 新建技能的 SKILL.md 模板；`variant` 缺省取 `desktop`。 */
export function buildNewSkillDoc(
  name: string,
  description: string,
  variant: SkillDocBodyVariant = "desktop",
): string {
  const frontMatter = [
    "---",
    `name: ${yamlScalar(name)}`,
    `description: ${yamlScalar(description)}`,
    "---",
    "",
  ];
  const body =
    variant === "mobile"
      ? [
          `# ${name}`,
          "",
          description,
          "",
          "## 使用说明",
          "",
          "- 这里描述技能的用途、触发时机与使用方式，模型会据此决定是否使用本技能。",
          "- 辅助文件可放在本目录或子目录（如 `references/notes.md`），",
          "  由模型经技能工具按需读取；正文无需内联全文。",
          "",
        ]
      : [
          `# ${name}`,
          "",
          description,
          "",
          "<!-- 在这里编写技能说明。可添加辅助文件（如 references/x.md），模型会经 skill 工具按需读取。 -->",
          "",
        ];
  return [...frontMatter, ...body].join("\n");
}