import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {ChatMessage} from '@novel-master/core';
import {MessageList} from '../src/components/chat/MessageList';

const mockScrollToEnd = jest.fn();
const mockScrollToOffset = jest.fn();

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      primary: '#06c',
      surface: '#fff',
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      bgSecondary: '#eee',
      borderLight: '#ddd',
    },
  }),
}));

jest.mock('../src/components/chat/ThinkingBlockCard', () => {
  const mockReact = require('react');
  return {
    ThinkingBlockCard: () => mockReact.createElement('ThinkingBlockCard'),
  };
});

jest.mock('../src/components/chat/ToolCallCard', () => {
  const mockReact = require('react');
  return {ToolCallCard: () => mockReact.createElement('ToolCallCard')};
});

jest.mock('../src/components/rich-content/RichContentBody', () => {
  const mockReact = require('react');
  return {RichContentBody: () => mockReact.createElement('RichContentBody')};
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  const FlatList = mockReact.forwardRef(
    (props: Record<string, unknown>, ref: unknown) => {
      mockReact.useImperativeHandle(ref, () => ({
        scrollToEnd: mockScrollToEnd,
        scrollToOffset: mockScrollToOffset,
      }));
      return mockReact.createElement('FlatList', props);
    },
  );
  return {
    FlatList,
    Pressable: ({
      children,
      ...rest
    }: {
      children?: React.ReactNode;
    }) => mockReact.createElement('Pressable', rest, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', null, children),
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

function sampleMessage(id: string): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq: 1,
    role: 'user',
    content: {blocks: [{type: 'text', text: 'hello'}]},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
  };
}

function flushScrollEffects() {
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

describe('MessageList scroll restore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockScrollToEnd.mockClear();
    mockScrollToOffset.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('T1: remount with cached offset does not scrollToEnd', () => {
    const messages = [sampleMessage('m1')];
    act(() => {
      TestRenderer.create(
        React.createElement(MessageList, {
          messages,
          initialScroll: {offsetY: 100, nearBottom: false},
        }),
      );
    });
    flushScrollEffects();
    expect(mockScrollToEnd).not.toHaveBeenCalled();
    expect(mockScrollToOffset).toHaveBeenCalledWith(
      expect.objectContaining({offset: 100, animated: false}),
    );
  });

  it('T2: new session without cache scrolls to end', () => {
    const messages = [sampleMessage('m1')];
    act(() => {
      TestRenderer.create(
        React.createElement(MessageList, {
          messages,
          defaultScrollToBottom: true,
        }),
      );
    });
    flushScrollEffects();
    expect(mockScrollToEnd).toHaveBeenCalled();
    expect(mockScrollToOffset).not.toHaveBeenCalled();
  });
});
