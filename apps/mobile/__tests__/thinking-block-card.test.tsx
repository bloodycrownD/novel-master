import React from 'react';
import {describe, expect, it, jest} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {ThinkingBlockCard} from '../src/components/chat/ThinkingBlockCard';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      text: '#111',
      textSecondary: '#666',
      textTertiary: '#999',
      bgSecondary: '#eee',
      borderLight: '#ddd',
      primary: '#06c',
    },
  }),
}));

jest.mock('../src/components/rich-content/RichContentBody', () => {
  const mockReact = require('react');
  return {
    RichContentBody: () => mockReact.createElement('RichContentBody'),
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Pressable: ({
      children,
      onPress,
      ...rest
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      mockReact.createElement('Pressable', {...rest, onPress}, children),
    StyleSheet: {create: (s: object) => s, hairlineWidth: 1},
    Text: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', null, children),
    View: ({children}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', null, children),
  };
});

describe('ThinkingBlockCard', () => {
  it('T3: uses RichContentBody when rich text enabled and expanded', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ThinkingBlockCard
          text={'# Title\n\n```ts\nconst x = 1;\n```'}
          defaultExpanded
          richTextEnabled
          richRenderEpoch={2}
          contentId="thinking-1"
        />,
      );
    });
    expect(tree!.root.findAllByType('RichContentBody' as never).length).toBe(1);
    expect(tree!.root.findAllByType('Text' as never).length).toBeGreaterThan(0);
  });

  it('keeps plain Text when rich text disabled', () => {
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ThinkingBlockCard
          text="**bold**"
          defaultExpanded
          richTextEnabled={false}
        />,
      );
    });
    expect(tree!.root.findAllByType('RichContentBody' as never).length).toBe(0);
  });
});
