/**
 * 以提交值为准重写 SKILL.md front matter 的 name / description 行
 * （保留其余键与正文），供「编辑信息」（重命名 + 描述编辑）与 ZIP 导入
 * front matter 回写共用。
 *
 * 语义对齐原 desktop / mobile 两份 UI 私有实现（回收为单源）：
 * - 有 front matter 块：逐 key 做行级正则替换（`^key:.*$`），块内缺失
 *   该 key 时追加到块尾；只重写提交了的字段，未提交字段原样保留。
 * - 无 front matter 块：前置补一个只含提交字段的块。
 * - 值一律写 YAML 双引号标量（JSON 字符串即合法 double-quoted scalar），
 *   含冒号 / 引号 / 换行的描述不会破坏解析。
 *
 * 注意：本函数不做解析校验——调用方（updateSkillInfo）先过
 * parseSkillFrontMatter，invalid 技能跳过重写，避免改名顺手「治好」
 * 无效技能。
 *
 * @module domain/skills/logic/with-skill-front-matter-values
 */

/** front matter 重写值：只提交要改的字段，未提交字段不动。 */
export interface SkillFrontMatterValues {
  readonly name?: string;
  readonly description?: string;
}

/** YAML 双引号标量：JSON 字符串本身即合法 YAML double-quoted scalar。 */
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/**
 * 重写 SKILL.md 的 front matter name / description（保留其余键与正文）。
 *
 * `values` 两个字段均缺省时原样返回（防御，调用方不应这样传）。
 */
export function withSkillFrontMatterValues(
  source: string,
  values: SkillFrontMatterValues
): string {
  const entries: Array<[string, string]> = [];
  if (values.name != null) {
    entries.push(["name", values.name]);
  }
  if (values.description != null) {
    entries.push(["description", values.description]);
  }
  if (entries.length === 0) {
    return source;
  }

  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const fmLine = (key: string, value: string) => `${key}: ${yamlScalar(value)}`;
  if (match == null) {
    const fm = entries.map(([key, value]) => fmLine(key, value)).join("\n");
    return `---\n${fm}\n---\n\n${source}`;
  }
  let fm = match[1]!;
  for (const [key, value] of entries) {
    const re = new RegExp(`^${key}:.*$`, "m");
    fm = re.test(fm)
      ? fm.replace(re, fmLine(key, value))
      : `${fm}\n${fmLine(key, value)}`;
  }
  return source.replace(match[0], `---\n${fm}\n---\n`);
}
