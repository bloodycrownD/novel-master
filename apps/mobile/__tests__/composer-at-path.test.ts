/**
 * T-ATD*：Mobile `@路径` 插入与 typeahead≤5；mentions 单层口径与原子删。
 */
import { describe, expect, it } from '@jest/globals';
import { parseValue } from 'react-native-controlled-mentions';
import { scanAtPathAttachments } from '@novel-master/core/chat';
import {
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatAtPathMentionMarkup,
  formatComposerAtPathToken,
  mentionValueToPlain,
  mergeProgrammaticPlainIntoMentionValue,
  replaceActiveAtWithToken,
  suggestionFromAtPathToken,
  tryAtomicMentionDelete,
  type ComposerAtPathTriggersConfig,
} from '../src/components/chat/composer-at-path';

const triggersConfig: ComposerAtPathTriggersConfig = {
  atPath: {
    trigger: '@',
    allowedSpacesCount: 0,
    isInsertSpaceAfterMention: true,
    getPlainString: mention => `@${mention.name}`,
  },
};

describe('composer-at-path (T-ATD*)', () => {
  it('T-ATD2: Picker token 为 @path；目录尾 /；扫描落库带前导 /', () => {
    const tokens = atPathTokensFromPickerSelection(['/notes'], ['/a.md']);
    expect(tokens).toEqual(['@/notes/', '@/a.md']);
    const scanned = scanAtPathAttachments(tokens.join(' '));
    expect(scanned).toHaveLength(2);
    expect(scanned[0]!.path).toBe('/notes/');
    expect(scanned[0]!.type).toBe('dir');
    expect(scanned[1]!.path).toBe('/a.md');
    expect(scanned.every(a => a.path!.startsWith('/'))).toBe(true);
  });

  it('T-ATD3: 手输 @ 搜索 ≤5，点选插入完整 @path', () => {
    const refs = [
      { path: '/a.md', kind: 'file' as const },
      { path: '/ab.md', kind: 'file' as const },
      { path: '/abc.md', kind: 'file' as const },
      { path: '/abcd.md', kind: 'file' as const },
      { path: '/abcde.md', kind: 'file' as const },
      { path: '/abcdef.md', kind: 'file' as const },
    ];
    expect(filterAtPathTypeaheadCandidates(refs, 'a', 5)).toHaveLength(5);

    const active = findActiveAtQuery('见 @ab', 5);
    expect(active).not.toBeNull();
    expect(active!.query).toBe('ab');
    const token = formatComposerAtPathToken('/ab.md', false);
    const next = replaceActiveAtWithToken('见 @ab', 5, active!.start, token);
    expect(next.text).toBe('见 @/ab.md ');
  });

  it('T-ATD4: 删除正文 @path 后扫描为空', () => {
    expect(countScannedAtPathAttachments('看 @/a.md')).toBe(1);
    expect(countScannedAtPathAttachments('看')).toBe(0);
  });

  it('mention ↔ plain：对外仍为纯字符串，不漏 {@} / HTML', () => {
    const markup = `见 ${formatAtPathMentionMarkup('/a.md')} 与 ${formatAtPathMentionMarkup('/notes/')} 补充`;
    const plain = mentionValueToPlain(markup);
    expect(plain).toBe('见 @/a.md 与 @/notes/ 补充');
    expect(plain.includes('{@}')).toBe(false);
    expect(plain.includes('<span')).toBe(false);
    expect(suggestionFromAtPathToken('@/a.md')).toEqual({
      id: '/a.md',
      name: '/a.md',
    });
  });

  it('程序化 merge：新增 @路径 成 mention，可原子删；手输纯文本不提升', () => {
    // 先有手输纯文本 @/x
    const withHandTyped = mergeProgrammaticPlainIntoMentionValue(
      '见 @/x ',
      '见 @/x ',
      triggersConfig,
    );
    expect(withHandTyped).toBe('见 @/x ');
    expect(withHandTyped.includes('{@}')).toBe(false);

    // 选择器再插入 @/a.md → 仅新增段成 mention
    const withPicker = mergeProgrammaticPlainIntoMentionValue(
      withHandTyped,
      '见 @/x @/a.md ',
      triggersConfig,
    );
    expect(mentionValueToPlain(withPicker)).toBe('见 @/x @/a.md ');
    expect(withPicker.includes(formatAtPathMentionMarkup('/a.md'))).toBe(true);
    expect(withPicker.includes(formatAtPathMentionMarkup('/x'))).toBe(false);

    const state = parseValue(withPicker, [triggersConfig.atPath]);
    expect(state.parts.some(p => p.data != null)).toBe(true);

    // 退一格碰到 mention → 整段删
    const tokenEnd = '见 @/x @/a.md'.length;
    const oneCharDeleted = `${state.plainText.slice(0, tokenEnd - 1)}${state.plainText.slice(tokenEnd)}`;
    const afterAtomic = tryAtomicMentionDelete(
      withPicker,
      oneCharDeleted,
      triggersConfig,
    );
    expect(afterAtomic).not.toBeNull();
    expect(mentionValueToPlain(afterAtomic!)).toBe('见 @/x  ');
    expect(afterAtomic!.includes('{@}')).toBe(false);
  });

  it('手输纯文本 @/x：退格不原子删', () => {
    const hand = '见 @/x';
    const tokenEnd = hand.length;
    const oneCharDeleted = `${hand.slice(0, tokenEnd - 1)}${hand.slice(tokenEnd)}`;
    const after = tryAtomicMentionDelete(hand, oneCharDeleted, triggersConfig);
    expect(after).toBeNull();
  });
});
