/**
 * T-SA8：plain Range 量测 / 邻域定位工具仍保留。
 * MD 新建批注：原生 menuItems + inject recogitoCreate；Recogito 仅投影。
 * mobile/B-1 / G-1：reportRecogitoCreateFromSelection 策略 (b) + 空白选区。
 */
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import React from 'react';
import {
  ANNOTATE_SOFT_RANGE_CHAR_PADDING,
  ANNOTATE_SOFT_RANGE_LINE_PADDING,
  estimateSoftOffsetRangeFromPlainOffsets,
  estimateSoftOffsetRangeFromQuoteContext,
} from '@novel-master/core/chat';
import {
  addChatAnnotateDraft,
  listChatAnnotateDrafts,
  resetChatAnnotateDraftStoreForTests,
} from '../src/storage/chat-annotate-draft';
import {
  getSelectionOffsetsInElement,
  collectAnnotateSelection,
  reportRecogitoCreateFromSelection,
  bindAnnotateCollectBridge,
} from '../src/web/rich-document/webview/runtime/annotate-collect';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const mockWebViewProps: Array<Record<string, unknown>> = [];

jest.mock('react-native-webview', () => {
  const React = require('react');
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockWebViewProps.push(props);
      return React.createElement(View, {testID: 'webview'});
    },
  };
});

jest.mock('@/webview-host/rich-document/uri', () => ({
  getRichDocumentUri: () => 'file:///rich-document/index.html',
  getRichDocumentPackageDirUri: () => 'file:///rich-document/',
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#fff',
      text: '#111',
      textSecondary: '#666',
      primary: '#007aff',
      surface: '#f2f2f7',
      borderLight: '#eee',
    },
  }),
}));

import {RichDocumentWebView} from '../src/components/vfs/RichDocumentWebView';

/** 最小 DOM：textContent 对齐无锚源；锚 span 不计入 Range.toString。 */
function installMiniDom(sourceText: string, selStart: number, selEnd: number) {
  const textNode = {
    nodeType: 3,
    data: sourceText,
    textContent: sourceText,
  };
  const body = {
    textContent: sourceText,
    contains: () => true,
    ownerDocument: {
      createRange: () => {
        let endOffset = 0;
        return {
          selectNodeContents: () => {
            endOffset = 0;
          },
          setEnd: (_n: unknown, offset: number) => {
            endOffset = offset;
          },
          toString: () => sourceText.slice(0, endOffset),
        };
      },
    },
  };
  const selRange = {
    startContainer: textNode,
    endContainer: textNode,
    startOffset: selStart,
    endOffset: selEnd,
    toString: () => sourceText.slice(selStart, selEnd),
  };
  const selection = {
    rangeCount: 1,
    isCollapsed: selStart === selEnd,
    getRangeAt: () => selRange,
    toString: () => sourceText.slice(selStart, selEnd),
  };
  (global as {document?: unknown}).document = {
    querySelector: (sel: string) => (sel === '.doc-body' ? body : null),
  };
  (global as {window?: unknown}).window = {
    getSelection: () => selection,
  };
  return {
    body: body as unknown as Element,
    selection: selection as unknown as Selection,
    sourceText,
  };
}

type PostedEnvelope = {
  v: number;
  type: string;
  payload: Record<string, unknown>;
};

function installPostCapture(): PostedEnvelope[] {
  const posts: PostedEnvelope[] = [];
  const prev = (global as {window?: Record<string, unknown>}).window ?? {};
  (global as {window?: unknown}).window = {
    ...prev,
    ReactNativeWebView: {
      postMessage: (raw: string) => {
        posts.push(JSON.parse(raw) as PostedEnvelope);
      },
    },
  };
  return posts;
}

describe('T-SA8 plain 量测 → estimateSoftOffsetRangeFromPlainOffsets', () => {
  afterEach(() => {
    delete (global as {document?: unknown}).document;
    delete (global as {window?: unknown}).window;
  });

  it('Range 半开 offset 相对无锚源串；padding CHAR→LINE；禁止以锚标签计长', () => {
    expect(ANNOTATE_SOFT_RANGE_CHAR_PADDING).toBe(32);
    expect(ANNOTATE_SOFT_RANGE_LINE_PADDING).toBe(2);
    const source = ['L1', 'L2', 'L3', 'TARGET HERE', 'L5', 'L6', 'L7'].join(
      '\n',
    );
    const selStart = source.indexOf('TARGET');
    const selEnd = selStart + 'TARGET'.length;
    const {body, selection} = installMiniDom(source, selStart, selEnd);
    const offsets = getSelectionOffsetsInElement(body, selection);
    expect(offsets).toEqual({start: selStart, end: selEnd});

    const soft = estimateSoftOffsetRangeFromPlainOffsets(
      source,
      offsets!.start,
      offsets!.end,
    );
    expect(soft.startOffset).toBeLessThanOrEqual(selStart);
    expect(soft.endOffset).toBeGreaterThanOrEqual(selEnd);
    expect(soft.endOffset - soft.startOffset).toBeGreaterThan(
      selEnd - selStart,
    );

    const collected = collectAnnotateSelection('plain');
    expect(collected?.selectionStart).toBe(selStart);
    expect(collected?.selectionEnd).toBe(selEnd);
    expect(collected?.originalText).toBe('TARGET');
  });
});

describe('reportRecogitoCreateFromSelection（mobile/B-1 / G-1）', () => {
  afterEach(() => {
    delete (global as {document?: unknown}).document;
    delete (global as {window?: unknown}).window;
  });

  it('正常选区：quote 与 renderStart/End 对齐 slice', () => {
    const source = 'alpha TARGET beta';
    const selStart = source.indexOf('TARGET');
    const selEnd = selStart + 'TARGET'.length;
    installMiniDom(source, selStart, selEnd);
    const posts = installPostCapture();
    reportRecogitoCreateFromSelection();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.type).toBe('recogitoCreate');
    const p = posts[0]!.payload;
    expect(p.quote).toBe('TARGET');
    expect(p.renderStart).toBe(selStart);
    expect(p.renderEnd).toBe(selEnd);
    expect(source.slice(Number(p.renderStart), Number(p.renderEnd))).toBe(
      p.quote,
    );
  });

  it('首尾空白选区：trim 后收缩 start/end（策略 b）', () => {
    const source = 'alpha  hello  beta';
    const needle = '  hello  ';
    const selStart = source.indexOf(needle);
    const selEnd = selStart + needle.length;
    installMiniDom(source, selStart, selEnd);
    const posts = installPostCapture();
    reportRecogitoCreateFromSelection();
    expect(posts).toHaveLength(1);
    const p = posts[0]!.payload;
    expect(p.quote).toBe('hello');
    expect(p.renderStart).toBe(source.indexOf('hello'));
    expect(p.renderEnd).toBe(source.indexOf('hello') + 'hello'.length);
    expect(source.slice(Number(p.renderStart), Number(p.renderEnd))).toBe(
      'hello',
    );
    expect(source.slice(Number(p.renderStart), Number(p.renderEnd))).toBe(
      p.quote,
    );
  });

  it('纯空白选区不发 recogitoCreate', () => {
    const source = 'alpha     beta';
    const selStart = source.indexOf('     ');
    const selEnd = selStart + 5;
    installMiniDom(source, selStart, selEnd);
    const posts = installPostCapture();
    reportRecogitoCreateFromSelection();
    expect(posts).toHaveLength(0);
  });

  it('生产 bind 只挂 __nmCollectRecogitoSelection，不挂旧 collect', () => {
    installMiniDom('x', 0, 1);
    installPostCapture();
    bindAnnotateCollectBridge();
    expect(typeof window.__nmCollectRecogitoSelection).toBe('function');
    expect(
      (window as {__nmCollectAnnotateSelection?: unknown})
        .__nmCollectAnnotateSelection,
    ).toBeUndefined();

    const collectSrc = readFileSync(
      join(
        __dirname,
        '../src/web/rich-document/webview/runtime/annotate-collect.ts',
      ),
      'utf8',
    );
    expect(collectSrc).toContain('__nmCollectRecogitoSelection');
    expect(collectSrc).not.toMatch(/__nmCollectAnnotateSelection\s*=/);

    const previewSrc = readFileSync(
      join(__dirname, '../src/components/vfs/FileMarkdownPreview.tsx'),
      'utf8',
    );
    expect(previewSrc).toMatch(/handleRecogitoCreate/);
    expect(previewSrc).not.toMatch(/payload\.quote\.trim\s*\(/);
  });
});

describe('T-SA8b 原生菜单 + Recogito 投影', () => {
  beforeEach(() => {
    mockWebViewProps.length = 0;
    resetChatAnnotateDraftStoreForTests();
  });

  afterEach(() => {
    resetChatAnnotateDraftStoreForTests();
    delete (global as {document?: unknown}).document;
    delete (global as {window?: unknown}).window;
  });

  it('RichDocumentWebView 挂 menuItems；批注走 inject + recogitoCreate', () => {
    const onRecogitoCreate = jest.fn();
    act(() => {
      TestRenderer.create(
        <RichDocumentWebView
          html="<p>hello</p>"
          annotateEnabled
          annotations={[
            {
              id: 'a1',
              originalText: 'hello',
              renderStart: 0,
              renderEnd: 5,
            },
          ]}
          onRecogitoCreate={onRecogitoCreate}
        />,
      );
    });
    const last = mockWebViewProps[mockWebViewProps.length - 1];
    expect(last?.menuItems).toBeDefined();
    expect(typeof last?.onCustomMenuSelection).toBe('function');

    const src = readFileSync(
      join(__dirname, '../src/components/vfs/RichDocumentWebView.tsx'),
      'utf8',
    );
    expect(src).toContain('RICH_DOCUMENT_ANNOTATE_MENU_ITEMS');
    expect(src).toContain('__nmCollectRecogitoSelection');
    expect(src).toContain('setAnnotations');
    expect(src).toContain('recogitoCreate');
    expect(src).toContain('onRecogitoCreate');
    expect(src).not.toContain('__nmCollectAnnotateSelection');
  });

  it('邻域定位成功写入半开 offset；无邻域多命中失败不写 offset（A12）', () => {
    const sessionId = 's-sa8b';
    const path = '/n.md';
    const content = 'xx SAME mid SAME yy\n';
    const second = content.lastIndexOf('SAME');

    const softOk = estimateSoftOffsetRangeFromQuoteContext(content, {
      originalText: 'SAME',
      contextBefore: ' mid ',
      contextAfter: ' yy',
    });
    expect(softOk).not.toBeNull();
    expect(softOk!.startOffset).toBeLessThanOrEqual(second);
    expect(softOk!.endOffset).toBeGreaterThan(second);
    expect(content.slice(second, second + 4)).toBe('SAME');

    addChatAnnotateDraft(sessionId, {
      id: 'ok',
      path,
      originalText: 'SAME',
      userAnnotation: 'hit',
      startOffset: softOk!.startOffset,
      endOffset: softOk!.endOffset,
    });
    const drafts = listChatAnnotateDrafts(sessionId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.startOffset).toBe(softOk!.startOffset);
    expect(drafts[0]?.endOffset).toBe(softOk!.endOffset);

    const fail = estimateSoftOffsetRangeFromQuoteContext(content, {
      originalText: 'SAME',
    });
    expect(fail).toBeNull();
  });

  it('markdown collect 产出 originalText + contextBefore/After（工具层残留）', () => {
    const source = 'alpha SAME beta';
    const selStart = source.indexOf('SAME');
    const selEnd = selStart + 4;
    installMiniDom(source, selStart, selEnd);
    const collected = collectAnnotateSelection('markdown');
    expect(collected?.originalText).toBe('SAME');
    expect(collected?.mode).toBe('markdown');
    expect(collected?.contextBefore).toContain('alpha');
    expect(collected?.contextAfter).toContain('beta');
  });
});
