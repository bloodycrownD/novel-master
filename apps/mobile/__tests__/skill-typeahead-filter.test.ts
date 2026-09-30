/**
 * `filterSkillTypeaheadCandidates` 纯函数单测（TS-STF）。
 *
 * 背景：函数从 `SkillTypeahead.tsx`（含 react-native / @/theme 依赖）抽到
 * 纯 .ts `skill-typeahead-filter.ts`，随 dock WebView 化要入 web bundle 自治
 * 过滤（spec「typeahead 自治」· r2-P1-1 前置抽取）。抽出后必须锁住三件事：
 * 过滤口径（跳过 invalid / 名称与描述双路匹配）、顺序（按入参序，不重排）、
 * 截断（limit 封顶 + 默认 5）；另断言 tsx 侧 re-export 是同一个函数引用，
 * 保证既有消费方（ChatComposer / PromptEditorScreen）import 路径不变。
 */
import {describe, expect, it} from '@jest/globals';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {filterSkillTypeaheadCandidates} from '@/components/chat/skill-typeahead-filter';
import {filterSkillTypeaheadCandidates as filterViaReExport} from '@/components/chat/SkillTypeahead';

function skill(over: Partial<EffectiveSkill> & {name: string}): EffectiveSkill {
  return {
    description: null,
    domain: 'project',
    overridden: false,
    disabled: false,
    valid: true,
    effective: true,
    ...over,
  };
}

describe('filterSkillTypeaheadCandidates', () => {
  it('过滤：跳过 valid=false，名称与描述两条匹配路径都命中，query 大小写与首尾空白不敏感', () => {
    const rows: EffectiveSkill[] = [
      skill({name: 'Alpha', description: 'first skill'}),
      skill({name: 'broken', description: 'looks fine', valid: false, effective: false}),
      skill({name: 'Beta', description: 'ALPHA helper'}),
      skill({name: 'Gamma', description: 'third'}),
    ];

    expect(filterSkillTypeaheadCandidates(rows, '  ALP  ').map(s => s.name)).toEqual([
      // 名称命中 Alpha；broken 被 valid=false 挡掉；Beta 靠描述命中。
      'Alpha',
      'Beta',
    ]);
    // 空 query（或全空白）不缩小集合，但仍受 limit 封顶。
    expect(filterSkillTypeaheadCandidates(rows, '   ').map(s => s.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('排序：命中项严格保持入参顺序，不按名称或描述重排', () => {
    const rows: EffectiveSkill[] = [
      skill({name: 'zeta', description: 'shared kw'}),
      skill({name: 'mid', description: 'shared kw'}),
      skill({name: 'alpha', description: 'shared kw'}),
      skill({name: 'nope', description: 'unrelated'}),
      skill({name: 'beta', description: 'shared kw'}),
    ];

    expect(filterSkillTypeaheadCandidates(rows, 'shared kw', 10).map(s => s.name)).toEqual([
      'zeta',
      'mid',
      'alpha',
      'beta',
    ]);
  });

  it('截断：limit 封顶在扫描到第 N 个命中时立刻停，默认值为 5', () => {
    const rows: EffectiveSkill[] = Array.from({length: 9}, (_, i) =>
      skill({name: `s${i}`, description: 'kw'}),
    );

    expect(filterSkillTypeaheadCandidates(rows, 'kw', 3).map(s => s.name)).toEqual(['s0', 's1', 's2']);
    expect(filterSkillTypeaheadCandidates(rows, 'kw')).toHaveLength(5);
    // limit 大于命中数时全量返回，不报错也不补齐。
    expect(filterSkillTypeaheadCandidates(rows, 'kw', 50)).toHaveLength(9);
  });

  it('抽取后 SkillTypeahead.tsx 的 re-export 与新模块是同一函数引用', () => {
    expect(filterViaReExport).toBe(filterSkillTypeaheadCandidates);
  });
});
