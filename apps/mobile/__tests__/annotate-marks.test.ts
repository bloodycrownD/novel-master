import {describe, expect, it} from '@jest/globals';
import {findAllOccurrences} from '../src/web/rich-document/webview/runtime/annotate-marks';

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
