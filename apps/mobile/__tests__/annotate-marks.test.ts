import {describe, expect, it} from '@jest/globals';
import {
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  parseAnnotateIdsAttr,
  sortAnnotateTextsLongestFirst,
} from '../src/web/rich-document/webview/runtime/annotate-marks';

describe('annotate-marks findAllOccurrences', () => {
  it('重复片段全部命中（非重叠）', () => {
    expect(findAllOccurrences('aaabaaa', 'aa')).toEqual([0, 4]);
    expect(findAllOccurrences('hello hello', 'hello')).toEqual([0, 6]);
  });

  it('空 needle → 空', () => {
    expect(findAllOccurrences('abc', '')).toEqual([]);
  });

  it('无匹配 → 空', () => {
    expect(findAllOccurrences('abc', 'z')).toEqual([]);
  });
});

describe('annotate-marks group / parse / sort（A-1 / B-3）', () => {
  it('同文聚合多 id；空原文与空 id 跳过', () => {
    const map = groupAnnotateIdsByOriginalText([
      {id: 'a', originalText: 'hello'},
      {id: 'b', originalText: 'hello'},
      {id: 'c', originalText: 'other'},
      {id: 'd', originalText: ''},
      {id: '', originalText: 'skip'},
    ]);
    expect(map.get('hello')).toEqual(['a', 'b']);
    expect(map.get('other')).toEqual(['c']);
    expect(map.has('')).toBe(false);
    expect(map.has('skip')).toBe(false);
  });

  it('parseAnnotateIdsAttr 解析逗号分隔 id', () => {
    expect(parseAnnotateIdsAttr('a,b , c')).toEqual(['a', 'b', 'c']);
    expect(parseAnnotateIdsAttr('')).toEqual([]);
    expect(parseAnnotateIdsAttr(null)).toEqual([]);
  });

  it('长 needle 优先于短 needle（重叠/嵌套）', () => {
    expect(
      sortAnnotateTextsLongestFirst(['ab', 'a', 'abc', 'abcd']),
    ).toEqual(['abcd', 'abc', 'ab', 'a']);
    // 嵌套：「长串」应先于其子串「短」
    expect(sortAnnotateTextsLongestFirst(['短', '更长短串'])).toEqual([
      '更长短串',
      '短',
    ]);
  });
});
