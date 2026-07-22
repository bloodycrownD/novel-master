/**
 * T-AT1 / T-AT2 / T-AT3 / T-SC1 + 既有 T-ATD*：
 * Mobile `@路径` 插入、mention 口径、原子删、无 attach chip、选中色。
 */
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { parseValue } from 'react-native-controlled-mentions';
import {
  partitionComposerChipAttachments,
  scanAtPathAttachments,
} from '@novel-master/core/chat';
import {
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
} from '../src/components/chat/composer-at-path';
import {
  formatAtPathMentionMarkup,
  mentionValueToPlain,
  mergeProgrammaticPlainIntoMentionValue,
  suggestionFromAtPathToken,
  tryAtomicMentionDelete,
  type ComposerAtPathTriggersConfig,
} from '../src/components/chat/composer-at-path-mention';
import {
  ComposerAtPathInput,
  type ComposerAtPathInputHandle,
} from '../src/components/chat/ComposerAtPathInput';
import { darkTheme, lightTheme } from '../src/theme/tokens';

jest.mock('../src/theme/ThemeProvider', () => {
  const { lightTheme: theme } = require('../src/theme/tokens') as typeof import('../src/theme/tokens');
  return {
    useTheme: () => ({
      mode: 'light' as const,
      tokens: theme,
      loaded: true,
      setMode: async () => undefined,
      toggleMode: async () => undefined,
    }),
  };
});

const triggersConfig: ComposerAtPathTriggersConfig = {
  atPath: {
    trigger: '@',
    allowedSpacesCount: 0,
    isInsertSpaceAfterMention: true,
    getPlainString: mention => `@${mention.name}`,
  },
  // 与生产 ComposerAtPathInput 同构：消息批注第二 trigger（suggest 恒空）
  msgAnnotate: {
    trigger: '§',
    allowedSpacesCount: 0,
    isInsertSpaceAfterMention: true,
    getPlainString: mention => mention.name,
  },
};

describe('composer-at-path (T-ATD* / T-AT* / T-SC1)', () => {
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

  it('findActiveAtQuery: @/a.md 无尾空格为活跃；带尾空格则关闭', () => {
    const bare = '@/a.md';
    expect(findActiveAtQuery(bare, bare.length)).not.toBeNull();
    expect(findActiveAtQuery(bare, bare.length)!.query).toBe('/a.md');
    expect(findActiveAtQuery(`${bare} `, `${bare} `.length)).toBeNull();
  });

  it('T-ATD4: 删除正文 @path 后扫描为空', () => {
    expect(countScannedAtPathAttachments('看 @/a.md')).toBe(1);
    expect(countScannedAtPathAttachments('看')).toBe(0);
  });

  it('T-AT1: mergeProgrammaticPlain 后 mention part 存在；plain 无 {@}', () => {
    const markup = `见 ${formatAtPathMentionMarkup('/a.md')} 与 ${formatAtPathMentionMarkup('/notes/')} 补充`;
    const plain = mentionValueToPlain(markup);
    expect(plain).toBe('见 @/a.md 与 @/notes/ 补充');
    expect(plain.includes('{@}')).toBe(false);
    expect(plain.includes('<span')).toBe(false);
    expect(suggestionFromAtPathToken('@/a.md')).toEqual({
      id: '/a.md',
      name: '/a.md',
    });

    const withPicker = mergeProgrammaticPlainIntoMentionValue(
      '',
      '见 @/a.md ',
      triggersConfig,
    );
    expect(mentionValueToPlain(withPicker)).toBe('见 @/a.md ');
    expect(withPicker.includes('{@}')).toBe(true);
    expect(mentionValueToPlain(withPicker).includes('{@}')).toBe(false);
    const state = parseValue(withPicker, [triggersConfig.atPath]);
    expect(state.parts.some(p => p.data != null)).toBe(true);
  });

  it('T-AT2: 原子删整段 @/path；手输纯文本不成 tag', () => {
    // 手输纯文本不提升
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

    // 手输纯文本 @/x：退格不原子删
    const hand = '见 @/x';
    const handEnd = hand.length;
    const handDeleted = `${hand.slice(0, handEnd - 1)}${hand.slice(handEnd)}`;
    expect(tryAtomicMentionDelete(hand, handDeleted, triggersConfig)).toBeNull();
  });

  it('T-AT3: 仅 @path 扫描为 source:attach，不进状态 chip', () => {
    const scanned = scanAtPathAttachments('请看 @/a.md');
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.every(a => a.source === 'attach')).toBe(true);
    const { status, attach } = partitionComposerChipAttachments(scanned);
    expect(status).toHaveLength(0);
    expect(attach).toHaveLength(scanned.length);
  });

  it('T-SC1: selectionColor 用 tokens.selection，≠ primary 原色', () => {
    expect(lightTheme.selection).not.toBe(lightTheme.primary);
    expect(darkTheme.selection).not.toBe(darkTheme.primary);
    expect(lightTheme.selection.startsWith(lightTheme.primary)).toBe(true);
    expect(darkTheme.selection.startsWith(darkTheme.primary)).toBe(true);

    const onChangeText = jest.fn();
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ComposerAtPathInput value="" onChangeText={onChangeText} />,
      );
    });
    const input = tree!.root.findByType(TextInput);
    expect(input.props.selectionColor).toBe(lightTheme.selection);
    expect(input.props.selectionColor).not.toBe(lightTheme.primary);
    // 默认非全程受控：无 pending 时 selection 为 undefined
    expect(input.props.selection).toBeUndefined();
  });

  it('程序化 replaceCommittedText 后对外 plain 无 {@}，且短暂设 selection', () => {
    const handleRef = React.createRef<ComposerAtPathInputHandle>();
    let text = '';
    const onChangeText = jest.fn((next: string) => {
      text = next;
    });
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ComposerAtPathInput
          ref={handleRef}
          value={text}
          onChangeText={onChangeText}
        />,
      );
    });

    act(() => {
      handleRef.current?.replaceCommittedText('见 @/a.md ', 9);
      tree!.update(
        <ComposerAtPathInput
          ref={handleRef}
          value={text}
          onChangeText={onChangeText}
        />,
      );
    });

    expect(onChangeText).toHaveBeenCalled();
    expect(text).toBe('见 @/a.md ');
    expect(text.includes('{@}')).toBe(false);

    const input = tree!.root.findByType(TextInput);
    expect(input.props.selection).toEqual({ start: 9, end: 9 });
  });
});
