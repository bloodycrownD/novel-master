/**
 * `$技能` typeahead 候选过滤（纯 .ts，零 react-native / react 依赖）。
 *
 * 为什么要单独成文件：typeahead 的 query 过滤随 dock WebView 化要进 web
 * bundle 自治计算（见 spec「typeahead 自治」）。函数原先住在
 * `SkillTypeahead.tsx` 里，那个文件 import 了 react-native / @/theme，
 * 直接入 web bundle 会把整棵 RN 组件树拖进去。故只把纯函数搬到这里，
 * `SkillTypeahead.tsx` 改 re-export——宏链 / 全屏屏等既有消费方 import
 * 路径零改动。
 *
 * es2018 纪律：本文件将被 web bundle 引入，禁 ES2021+ 运行时 API
 * （structuredClone / Array.at / Object.hasOwn / replaceAll）与 lookbehind
 * 正则。实现只用 trim / toLowerCase / includes（ES5~ES2015）。
 */
import type {EffectiveSkill} from '@novel-master/core/skills';

/** 候选过滤：仅有效技能；名称 / 描述模糊匹配，最多 `limit` 条（默认 5）。 */
export function filterSkillTypeaheadCandidates(
  skills: readonly EffectiveSkill[],
  query: string,
  limit = 5,
): EffectiveSkill[] {
  const q = query.trim().toLowerCase();
  const out: EffectiveSkill[] = [];
  for (const skill of skills) {
    if (!skill.valid) {
      continue;
    }
    const nameLower = skill.name.toLowerCase();
    const descLower = skill.description?.toLowerCase() ?? '';
    if (q === '' || nameLower.includes(q) || descLower.includes(q)) {
      out.push(skill);
      if (out.length >= limit) {
        break;
      }
    }
  }
  return out;
}
