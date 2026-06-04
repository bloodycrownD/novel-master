import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {
  MessageActionMenu,
  computeMessageActionMenuWidth,
  layoutAnchoredMenu,
} from '../src/components/chat/MessageActionMenu';
import {buildMessageActionItems} from '../src/components/chat/message-edit';
import type {ChatMessage} from '@novel-master/core';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      surfaceElevated: '#fff',
      border: '#ccc',
      text: '#111',
      danger: '#c00',
    },
  }),
}));

jest.mock('../src/components/ui/AppModal', () => {
  const mockReact = require('react');
  return {
    AppModal: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible?: boolean;
    }) =>
      visible ? mockReact.createElement('Modal', null, children) : null,
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Dimensions: {
      get: () => ({width: 360, height: 640}),
    },
    Pressable: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('Pressable', props, children),
    ScrollView: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('ScrollView', props, children),
    StyleSheet: {
      absoluteFill: {},
      hairlineWidth: 1,
      create: (s: object) => s,
    },
    Text: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', props, children),
    View: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', props, children),
  };
});

function sampleMessage(): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    seq: 1,
    role: 'user',
    content: {blocks: [{type: 'text', text: 'hi'}]},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
  };
}

describe('MessageActionMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders ScrollView when six action items are shown', () => {
    const items = buildMessageActionItems(sampleMessage());
    expect(items).toHaveLength(6);

    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <MessageActionMenu
          visible
          anchor={{x: 40, y: 200, width: 200, height: 48}}
          items={items}
          onSelect={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });

    const scrollViews = tree!.root.findAllByType('ScrollView' as never);
    expect(scrollViews.length).toBeGreaterThanOrEqual(1);
  });

  it('computeMessageActionMenuWidth stays compact for six items', () => {
    const items = buildMessageActionItems(sampleMessage());
    const width = computeMessageActionMenuWidth(items, 360);
    expect(width).toBeLessThanOrEqual(200);
    expect(width).toBeGreaterThanOrEqual(132);
  });

  it('layoutAnchoredMenu returns bounded maxHeight for six items', () => {
    const items = buildMessageActionItems(sampleMessage());
    const menuWidth = computeMessageActionMenuWidth(items, 360);
    const layout = layoutAnchoredMenu(
      {x: 40, y: 200, width: 200, height: 48},
      6,
      menuWidth,
      360,
      640,
    );
    expect(layout.width).toBe(menuWidth);
    expect(layout.maxHeight).toBeLessThanOrEqual(360);
    expect(layout.maxHeight).toBe(288);
  });
});
