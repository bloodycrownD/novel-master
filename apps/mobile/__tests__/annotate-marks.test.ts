import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  ANNOTATE_IDS_ATTR,
  ANNOTATE_MARK_CLASS,
  applyAnnotateMarks,
  findAllOccurrences,
  groupAnnotateIdsByOriginalText,
  parseAnnotateIdsAttr,
  sortAnnotateTextsLongestFirst,
  unwrapAnnotateMarks,
} from '../src/web/rich-document/webview/runtime/annotate-marks';
import {
  createMiniRoot,
  type MiniElement,
} from '../test-utils/annotate-mini-dom';

/** `<p>hel<strong>lo</strong></p>` */
function rootCrossStrong(): MiniElement {
  return createMiniRoot((doc, root) => {
    const p = doc.createElement('p');
    p.appendChild(doc.createTextNode('hel'));
    const strong = doc.createElement('strong');
    strong.appendChild(doc.createTextNode('lo'));
    p.appendChild(strong);
    root.appendChild(p);
  });
}

/** `<p>hel</p><p>lo</p>` */
function rootCrossParagraph(): MiniElement {
  return createMiniRoot((doc, root) => {
    const p1 = doc.createElement('p');
    p1.appendChild(doc.createTextNode('hel'));
    const p2 = doc.createElement('p');
    p2.appendChild(doc.createTextNode('lo'));
    root.appendChild(p1);
    root.appendChild(p2);
  });
}

/** `<p>hello hello</p>` */
function rootDoubleHello(): MiniElement {
  return createMiniRoot((doc, root) => {
    const p = doc.createElement('p');
    p.appendChild(doc.createTextNode('hello hello'));
    root.appendChild(p);
  });
}

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

describe('annotate-marks apply DOM（T-XN2 / T-XN4 / T-XN5 / T-XN6）', () => {
  it('T-XN2: 跨 strong 两段 mark，并集覆盖 hello', () => {
    const root = rootCrossStrong();
    applyAnnotateMarks(root as unknown as ParentNode, [
      {id: 'd1', originalText: 'hello'},
    ]);
    const marks = root.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`);
    expect(marks.length).toBe(2);
    expect(marks.map(m => m.textContent).join('')).toBe('hello');
  });

  it('T-XN4: 多段 mark 的 data-annotate-ids 一致且可 parse', () => {
    const root = rootCrossStrong();
    applyAnnotateMarks(root as unknown as ParentNode, [
      {id: 'a', originalText: 'hello'},
      {id: 'b', originalText: 'hello'},
    ]);
    const marks = root.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`);
    expect(marks.length).toBeGreaterThanOrEqual(2);
    const attrs = marks.map(m => m.getAttribute(ANNOTATE_IDS_ATTR));
    expect(new Set(attrs).size).toBe(1);
    expect(parseAnnotateIdsAttr(attrs[0])).toEqual(['a', 'b']);
  });

  it('T-XN5: 原文不在文档 → 无 mark', () => {
    const root = rootCrossStrong();
    applyAnnotateMarks(root as unknown as ParentNode, [
      {id: 'x', originalText: 'missing'},
    ]);
    expect(root.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`).length).toBe(0);
  });

  it('T-XN6: 同文两处均标；长串优先抢占短串', () => {
    const root = rootDoubleHello();
    applyAnnotateMarks(root as unknown as ParentNode, [
      {id: 'long', originalText: 'hello hello'},
      {id: 'short', originalText: 'hello'},
    ]);
    const marks = root.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`);
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('hello hello');
    expect(parseAnnotateIdsAttr(marks[0]?.getAttribute(ANNOTATE_IDS_ATTR))).toEqual([
      'long',
    ]);

    const root2 = rootDoubleHello();
    applyAnnotateMarks(root2 as unknown as ParentNode, [
      {id: 's', originalText: 'hello'},
    ]);
    const marks2 = root2.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`);
    expect(marks2.length).toBe(2);
    expect(marks2.map(m => m.textContent)).toEqual(['hello', 'hello']);
  });

  it('B-1: 先长后短，跨已有 mark 的短针不得误命中', () => {
    // 文档「h」+「ell」+「o」；长针先包 ell 后，短针「ho」不得跨 mark 拼域命中
    const root = createMiniRoot((doc, rootEl) => {
      const p = doc.createElement('p');
      p.appendChild(doc.createTextNode('hello'));
      rootEl.appendChild(p);
    });
    applyAnnotateMarks(root as unknown as ParentNode, [
      {id: 'long', originalText: 'ell'},
      {id: 'short', originalText: 'ho'},
    ]);
    const marks = root.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`);
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent).toBe('ell');
    expect(parseAnnotateIdsAttr(marks[0]?.getAttribute(ANNOTATE_IDS_ATTR))).toEqual([
      'long',
    ]);
    expect(root.textContent).toBe('hello');
  });

  it('跨 p 不误命中；unwrap 后再 apply 无残留', () => {
    const root = rootCrossParagraph();
    applyAnnotateMarks(root as unknown as ParentNode, [
      {id: 'x', originalText: 'hello'},
    ]);
    expect(root.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`).length).toBe(0);

    const root2 = rootCrossStrong();
    applyAnnotateMarks(root2 as unknown as ParentNode, [
      {id: 'd1', originalText: 'hello'},
    ]);
    expect(root2.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`).length).toBe(2);
    unwrapAnnotateMarks(root2 as unknown as ParentNode);
    expect(root2.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`).length).toBe(0);
    applyAnnotateMarks(root2 as unknown as ParentNode, [
      {id: 'd1', originalText: 'hello'},
    ]);
    expect(root2.querySelectorAll(`.${ANNOTATE_MARK_CLASS}`).length).toBe(2);
  });

  it('废弃 200×findFirst：源码不再含该模型', () => {
    const src = readFileSync(
      path.join(
        __dirname,
        '..',
        'src',
        'web',
        'rich-document',
        'webview',
        'runtime',
        'annotate-marks.ts',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/findFirstUnmarkedPlainMatch/);
    expect(src).not.toMatch(/guard\+\+ < 200/);
    expect(src).toMatch(/buildFlatTextIndex/);
    expect(src).toMatch(/mapFlatRangeToSegments/);
  });

  it('T-XN4 点击合同：多段任一段 closest 可得同 ids（源码回归）', () => {
    const annotateSrc = readFileSync(
      path.join(
        __dirname,
        '..',
        'src',
        'web',
        'rich-document',
        'webview',
        'runtime',
        'annotate.ts',
      ),
      'utf8',
    );
    expect(annotateSrc).toMatch(/target\.closest\(`\.\$\{ANNOTATE_MARK_CLASS\}`\)/);
    expect(annotateSrc).toMatch(/parseAnnotateIdsAttr/);
  });
});
