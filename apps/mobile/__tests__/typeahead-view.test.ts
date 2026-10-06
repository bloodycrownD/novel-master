/**
 * typeahead-view 纯函数迁移保真测试（composer-native-2026-10 Step 4 · T-NC8 纯函数半）。
 *
 * `native-composer/typeahead-view.ts` 逐字迁自 web `chat-conversation/webview/typeahead.ts`；
 * 本套件锁的是「与 web 版行为一致的最小用例集」——触发符前须空白/行首、query 含
 * 空白终止、候选过滤模糊匹配、上限 5、幂等键。触发判定与过滤的实现本体是 core /
 * RN 既有纯函数（findActiveAtQuery / filterAtPathTypeaheadCandidates /
 * filterSkillTypeaheadCandidates），其完整行为由各自既有套件守护，这里只锁迁移
 * 面上的组合口径。
 */
import type {AtPathRef} from '@/components/chat/composer-at-path';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {
  computeTypeaheadView,
  skillTypeaheadTag,
  TYPEAHEAD_LIMIT,
  typeaheadRenderKey,
} from '../src/components/chat/native-composer/typeahead-view';

const file = (path: string): AtPathRef => ({path, kind: 'file'});
const dir = (path: string): AtPathRef => ({path, kind: 'dir'});

const makeSkill = (over: Partial<EffectiveSkill>): EffectiveSkill => ({
  name: '技能',
  description: null,
  domain: 'project',
  overridden: false,
  disabled: false,
  valid: true,
  effective: true,
  ...over,
});

describe('computeTypeaheadView（web 版行为对齐）', () => {
  const source = {
    files: [file('src/a.ts'), file('src/b.ts'), dir('src')],
    skills: [makeSkill({name: '写作'})],
  };

  it('触发符前须空白/行首（findActiveAtQuery 口径）', () => {
    // 前贴普通字符：不是触发位
    expect(computeTypeaheadView('正文@sr', 6, source, true)).toBeNull();
    // 行首触发
    expect(computeTypeaheadView('@sr', 3, source, true)).not.toBeNull();
    // 空白/换行/制表符前触发
    expect(computeTypeaheadView(' @sr', 4, source, true)).not.toBeNull();
    expect(computeTypeaheadView('a\n@sr', 5, source, true)).not.toBeNull();
    expect(computeTypeaheadView('a\t@sr', 5, source, true)).not.toBeNull();
  });

  it('query 含空白/换行即终止（无活跃 token）', () => {
    // 触发后打了空格：query 含空白 → null
    expect(computeTypeaheadView(' @sr c', 6, source, true)).toBeNull();
    expect(computeTypeaheadView(' @sr\nc', 6, source, true)).toBeNull();
    // 光标回退到触发符之前：无活跃 token
    expect(computeTypeaheadView(' @sr', 0, source, true)).toBeNull();
  });

  it('候选过滤模糊匹配（path / basename 子串，大小写不敏感）', () => {
    const view = computeTypeaheadView('@SR', 3, source, true);
    expect(view).not.toBeNull();
    expect(view?.trigger).toBe('@');
    expect(view?.query).toBe('SR');
    // 大小写不敏感：'SR' 命中全部 src 段候选
    expect(view?.items.map(item => item.token)).toEqual([
      '@/src/a.ts',
      '@/src/b.ts',
      '@/src/',
    ]);
  });

  it('候选上限 5（TYPEAHEAD_LIMIT）', () => {
    const many = {
      files: [
        file('src/1.ts'),
        file('src/2.ts'),
        file('src/3.ts'),
        file('src/4.ts'),
        file('src/5.ts'),
        file('src/6.ts'),
        file('src/7.ts'),
      ],
      skills: [],
    };
    const view = computeTypeaheadView('@src', 4, many, true);
    expect(view?.items.length).toBe(TYPEAHEAD_LIMIT);
    expect(TYPEAHEAD_LIMIT).toBe(5);
    expect(view?.items.length).toBeLessThanOrEqual(5);
  });

  it('候选空 / 禁用 → null（不渲染判据 E5）', () => {
    // 无命中
    expect(computeTypeaheadView('@zzz', 4, source, true)).toBeNull();
    // 禁用时即使有活跃 query 也不展开
    expect(computeTypeaheadView('@sr', 3, source, false)).toBeNull();
    // 空 query（只有触发符）→ 全量候选兜出
    const open = computeTypeaheadView('@', 1, source, true);
    expect(open?.items.length).toBe(3);
  });

  it('$ 触发走技能过滤：无效技能排除、name/description 命中、tag 口径', () => {
    const skills = {
      files: [],
      skills: [
        makeSkill({name: '写作助手', description: '写小说用'}),
        makeSkill({name: '坏技能', valid: false}),
      ],
    };
    const byDesc = computeTypeaheadView('$小说', 3, skills, true);
    expect(byDesc?.trigger).toBe('$');
    expect(byDesc?.items.map(item => item.token)).toEqual(['$写作助手']);
    expect(byDesc?.items[0]?.label).toBe('$ 写作助手');
    expect(byDesc?.items[0]?.tag).toBe('项目');

    // 无效技能不进候选
    expect(computeTypeaheadView('$坏', 2, skills, true)).toBeNull();

    // tag 口径（对齐退役 SkillTypeahead 的现网文案）
    expect(skillTypeaheadTag(makeSkill({domain: 'global'}))).toBe('全局');
    expect(skillTypeaheadTag(makeSkill({disabled: true}))).toBe('已关闭');
    expect(
      skillTypeaheadTag(makeSkill({overridden: true, domain: 'project'})),
    ).toBe('项目 · 覆盖全局');
  });

  it('幂等键：trigger|start|候选 token 串；null → none', () => {
    const view = computeTypeaheadView('@src', 4, source, true);
    expect(typeaheadRenderKey(null)).toBe('none');
    // 同视图两次计算 → 键相同（RN 侧作为浮层容器 key，键同不重挂）
    expect(typeaheadRenderKey(view)).toBe(typeaheadRenderKey(view));
    // 候选集收窄（3 条 → 1 条）→ 键变化
    const narrowed = computeTypeaheadView('@src/b', 6, source, true);
    expect(narrowed?.items.length).toBe(1);
    expect(typeaheadRenderKey(narrowed)).not.toBe(typeaheadRenderKey(view));
    // 触发形态变化（@ → $）→ 键变化
    const skillView = computeTypeaheadView('@src $写', 7, source, true);
    expect(skillView?.trigger).toBe('$');
    expect(typeaheadRenderKey(skillView)).not.toBe(typeaheadRenderKey(view));
  });
});
