/**
 * T-SA8：plain Range 量测 / 邻域定位工具仍保留。
 * 旧 menuItems → collect 主通道已退役（Recogito MD-only）；此处断言宿主不再挂该路径。
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
  };
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

describe('T-SA8b 旧 menuItems 采集退役；邻域工具仍可用', () => {
  beforeEach(() => {
    mockWebViewProps.length = 0;
    resetChatAnnotateDraftStoreForTests();
  });

  afterEach(() => {
    resetChatAnnotateDraftStoreForTests();
    delete (global as {document?: unknown}).document;
    delete (global as {window?: unknown}).window;
  });

  it('RichDocumentWebView 不挂 menuItems / onAnnotateCollect；走 Recogito', () => {
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
    expect(last?.menuItems).toBeUndefined();
    expect(last?.onCustomMenuSelection).toBeUndefined();
    expect(last?.onAnnotateCollect).toBeUndefined();

    const src = readFileSync(
      join(__dirname, '../src/components/vfs/RichDocumentWebView.tsx'),
      'utf8',
    );
    expect(src).not.toContain('menuItems');
    expect(src).not.toContain('RICH_DOCUMENT_ANNOTATE_MENU_ITEMS');
    expect(src).not.toContain('__nmCollectAnnotateSelection');
    expect(src).not.toContain('onAnnotateCollect');
    expect(src).toContain('setAnnotations');
    expect(src).toContain('recogitoCreate');
    expect(src).toContain('onRecogitoCreate');
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
