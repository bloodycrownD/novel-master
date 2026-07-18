/**
 * T-ATD*：Mobile `@路径` 插入与 typeahead≤5；tapper facet 口径与原子删。
 */
import { describe, expect, it } from '@jest/globals';
import { Tapper } from '@bsky.app/tapper';
import { scanAtPathAttachments } from '@novel-master/core/chat';
import {
  COMPOSER_AT_PATH_FACET_PATTERN,
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
  uncommitHandTypedFacet,
} from '../src/components/chat/composer-at-path';

/** 用与 tapper 相同的 boundary 剥离逻辑收集 `@token` 列表（单测辅助）。 */
function matchAtPathFacets(text: string): string[] {
  const re = new RegExp(
    COMPOSER_AT_PATH_FACET_PATTERN.source,
    COMPOSER_AT_PATH_FACET_PATTERN.flags,
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    const boundaryLen = m[1]?.length ?? 0;
    out.push(m[0]!.slice(boundaryLen));
  }
  return out;
}

/** 模拟 ComposerAtPathInput：非程序化 facetCommitted → 反标。 */
function attachHandTypedUncommitGate(
  tapper: Tapper,
  programmatic: { current: boolean },
) {
  return tapper.on('facetCommitted', facet => {
    if (programmatic.current) {
      return;
    }
    if (uncommitHandTypedFacet(tapper.nodes, facet)) {
      tapper.insert('');
    }
  });
}

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

  it('facet 正则：识别 @token（含目录尾 /）；正文仍为纯字符串', () => {
    const text = '见 @/a.md 与 @/notes/ 补充';
    expect(matchAtPathFacets(text)).toEqual(['@/a.md', '@/notes/']);
    expect(text.includes('{@}')).toBe(false);
    expect(text.includes('<span')).toBe(false);
  });

  it('程序化 replaceText：已提交 @路径 可原子删；对外 text 仍为纯字符串', () => {
    const tapper = new Tapper({
      facets: { atPath: COMPOSER_AT_PATH_FACET_PATTERN },
      initialText: '',
    });
    const programmatic = { current: false };
    attachHandTypedUncommitGate(tapper, programmatic);

    programmatic.current = true;
    tapper.replaceText('见 @/a.md ', '见 @/a.md '.length);
    programmatic.current = false;

    expect(tapper.nodes.some(n => n.type === 'facet' && n.committed)).toBe(
      true,
    );
    // 光标在 token 末尾空格前：`见 @/a.md| `
    const tokenEnd = '见 @/a.md'.length;
    tapper.handleSelectionChange({
      nativeEvent: { selection: { start: tokenEnd, end: tokenEnd } },
    });
    // 模拟退一格（原生会删掉最后一个字符 `d`）
    const oneCharDeleted = `${tapper.text.slice(0, tokenEnd - 1)}${tapper.text.slice(tokenEnd)}`;
    tapper.handleTextChange(oneCharDeleted);
    expect(tapper.text).toBe('见  ');
    expect(tapper.text.includes('{@}')).toBe(false);
  });

  it('手输完整 @/x 后离开/commit：反标 committed，退格不原子删', () => {
    const tapper = new Tapper({
      facets: { atPath: COMPOSER_AT_PATH_FACET_PATTERN },
      initialText: '',
    });
    const programmatic = { current: false };
    attachHandTypedUncommitGate(tapper, programmatic);

    // 模拟逐字输入完整 token
    tapper.handleTextChange('@/x');
    expect(tapper.nodes.some(n => n.type === 'facet')).toBe(true);
    expect(tapper.nodes.some(n => n.type === 'facet' && n.committed)).toBe(
      false,
    );

    // 光标离开 facet（移到文首）→ tapper 自动 commit → 门闩反标
    tapper.handleSelectionChange({
      nativeEvent: { selection: { start: 0, end: 0 } },
    });
    expect(tapper.nodes.some(n => n.type === 'facet' && n.committed)).toBe(
      false,
    );

    // 移到 token 末尾再退一格：应只删一字，非整段
    const tokenEnd = '@/x'.length;
    tapper.handleSelectionChange({
      nativeEvent: { selection: { start: tokenEnd, end: tokenEnd } },
    });
    const oneCharDeleted = `${tapper.text.slice(0, tokenEnd - 1)}${tapper.text.slice(tokenEnd)}`;
    tapper.handleTextChange(oneCharDeleted);
    expect(tapper.text).toBe('@/');
  });
});
