/**
 * YAML 双引号标量：JSON 字符串本身即合法 YAML double-quoted scalar。
 *
 * 抽成本模块是为了让「front matter 回写」（withSkillFrontMatterValues）与
 * 「新建模板」（buildNewSkillDoc）共用同一个实现——此前两端 UI 各自手拼一份，
 * desktop 端裸插值、mobile 端转义，同一输入在两端产出的 front matter 行为不一致。
 *
 * @module domain/skills/logic/yaml-scalar
 */

export function yamlScalar(value: string): string {
  return JSON.stringify(value);
}