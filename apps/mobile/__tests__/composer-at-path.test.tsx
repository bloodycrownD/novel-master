/**
 * T-AT1 / T-AT2 / T-AT3 / T-SC1 + 既有 T-ATD*：
 * Mobile `@路径` 插入、mention 口径、原子删、无 attach chip、选中色。
 */
import {describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import {TextInput} from 'react-native';
import TestRenderer, {act} from 'react-test-renderer';
import {parseValue} from 'react-native-controlled-mentions';
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
} from '@/components/chat/composer-at-path';
import {
  formatAtPathMentionMarkup,
  mentionValueToPlain,
  mergeProgrammaticPlainIntoMentionValue,
  promotePlainMentions,
  suggestionFromAtPathToken,
  tryAtomicMentionDelete,
  type ComposerAtPathTriggersConfig,
} from '@/components/chat/composer-at-path-mention';
import {
  ComposerAtPathInput,
  type ComposerAtPathInputHandle,
} from '@/components/chat/ComposerAtPathInput';
import {darkTheme, lightTheme} from '@/theme/tokens';

jest.mock('@/theme/ThemeProvider', () => {
  const {lightTheme: theme} =
    require('@/theme/tokens') as typeof import('@/theme/tokens');
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
      {path: '/a.md', kind: 'file' as const},
      {path: '/ab.md', kind: 'file' as const},
      {path: '/abc.md', kind: 'file' as const},
      {path: '/abcd.md', kind: 'file' as const},
      {path: '/abcde.md', kind: 'file' as const},
      {path: '/abcdef.md', kind: 'file' as const},
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
    const markup = `见 ${formatAtPathMentionMarkup(
      '/a.md',
    )} 与 ${formatAtPathMentionMarkup('/notes/')} 补充`;
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
    const oneCharDeleted = `${state.plainText.slice(
      0,
      tokenEnd - 1,
    )}${state.plainText.slice(tokenEnd)}`;
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
    expect(
      tryAtomicMentionDelete(hand, handDeleted, triggersConfig),
    ).toBeNull();
  });

  it('T-AT2b: 纯文本快速路径——无 mention 标记时打字/删除均直接短路', () => {
    // 长纯文本：无论打字（文本变长）还是删除，都不得进入全文解析路径
    const long = '很长的纯文本'.repeat(200);
    expect(
      tryAtomicMentionDelete(long, long + '字', triggersConfig),
    ).toBeNull();
    expect(
      tryAtomicMentionDelete(long, long.slice(0, long.length - 3)),
    ).toBeNull();
  });

  it('T-AT3: 仅 @path 扫描为 source:attach，不进状态 chip', () => {
    const scanned = scanAtPathAttachments('请看 @/a.md');
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.every(a => a.source === 'attach')).toBe(true);
    const {status, attach} = partitionComposerChipAttachments(scanned);
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

  it('带 tag 打字不丢 tag——自愈对账按 plain 空间比较（v1.5.9 回归）', () => {
    // 场景：草稿水化出 @path tag → 原生上报 plain 形态 + 新字（markup 从不进
    // 原生 buffer）。旧对账拿 markup 与 plain 比较恒不等 → resolved=truth
    // 把 markup 整个替换成 plain → tag 一打字必死。修复后 plain 空间比较。
    const plain0 = '看 @/chapters/01.md 这段';
    let text = '';
    const onChangeText = jest.fn((next: string) => {
      text = next;
    });
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ComposerAtPathInput value="" onChangeText={onChangeText} />,
      );
    });
    act(() => {
      tree!.update(
        <ComposerAtPathInput value={plain0} onChangeText={onChangeText} />,
      );
    });
    const input = () => tree!.root.findByType(TextInput);
    // 水化后：children 为 plain 形态，且存在着色 mention span
    expect(collectText(input().props.children)).toBe(plain0);
    expect(hasMentionSpan(input().props.children)).toBe(true);

    // 模拟原生上报：plain + 一个中文字
    act(() => {
      input().props.onChangeText(`${plain0}字`);
    });
    expect(collectText(input().props.children)).toBe(`${plain0}字`);
    expect(hasMentionSpan(input().props.children)).toBe(true);
    expect(text).toBe(`${plain0}字`);
    act(() => {
      tree!.unmount();
    });
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
    expect(input.props.selection).toEqual({start: 9, end: 9});
  });
});

describe('promotePlainMentions（草稿水化恢复 tag）', () => {
  it('完整 @path / $skill 全部提为 mention，plain 不变', () => {
    const config: import('@/components/chat/composer-at-path-mention').ComposerTriggersConfig =
      {
        atPath: triggersConfig.atPath,
        skill: {
          trigger: '$',
          allowedSpacesCount: 0,
          isInsertSpaceAfterMention: true,
          getPlainString: mention => `$${mention.name}`,
        },
      };
    const plain = '看 @/chapters/01.md 与 $写作技能 再回我';
    const promoted = promotePlainMentions(plain, config);
    expect(promoted).toContain('{@}[/chapters/01.md](/chapters/01.md)');
    expect(promoted).toContain('{$}[写作技能](写作技能)');
    expect(mentionValueToPlain(promoted)).toBe(plain);
  });

  it('空串 / 无 token 原样返回', () => {
    expect(promotePlainMentions('', triggersConfig)).toBe('');
    expect(promotePlainMentions('普通文本', triggersConfig)).toBe('普通文本');
  });
});

function collectText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  const el = node as {props?: {children?: unknown}};
  return el?.props && 'children' in el.props
    ? collectText(el.props.children)
    : '';
}

function hasMentionSpan(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasMentionSpan);
  const el = node as {
    props?: {style?: Record<string, unknown>; children?: unknown};
  };
  const style = el?.props?.style;
  if (style && style.borderRadius === 6) return true;
  return el?.props && 'children' in el.props
    ? hasMentionSpan(el.props.children)
    : false;
}
