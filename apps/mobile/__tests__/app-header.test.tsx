import React from 'react';
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {AppHeader} from '../src/components/chrome/AppHeader';
import type {ChatHeaderContext} from '../src/navigation/types';

const mockChat: ChatHeaderContext = {
  chatSubview: 'sessions',
  sessionListPanel: 'sessions',
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      headerBackground: '#fff',
      border: '#eee',
      text: '#111',
      primary: '#007',
    },
    mode: 'light',
    toggleMode: jest.fn(),
  }),
}));

jest.mock('../src/navigation/HeaderContext', () => ({
  useHeaderContext: () => ({chat: mockChat, stackOverride: undefined}),
}));

jest.mock('../src/components/icons/TabIcons', () => {
  const mockReact = require('react');
  const Icon = () => mockReact.createElement('Icon');
  return {
    BackIcon: Icon,
    MenuIcon: Icon,
    MoonIcon: Icon,
    SunIcon: Icon,
  };
});

jest.mock('react-native', () => {
  const mockReact = require('react');
  return {
    Pressable: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('Pressable', props, children),
    StyleSheet: {
      hairlineWidth: 1,
      create: (s: object) => s,
    },
    Text: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('Text', props, children),
    View: ({children, ...props}: {children?: React.ReactNode}) =>
      mockReact.createElement('View', props, children),
  };
});

function headerTitle(root: TestRenderer.ReactTestInstance): string {
  const texts = root.findAll(node => node.type === 'Text');
  const title = texts.find(node => node.props.accessibilityRole === 'header');
  return String(title?.props.children ?? '');
}

describe('AppHeader', () => {
  beforeEach(() => {
    mockChat.chatSubview = 'sessions';
    mockChat.sessionListPanel = 'sessions';
    mockChat.projectName = undefined;
    mockChat.sessionTitle = undefined;
  });

  it('会话列表态显示当前项目名称', () => {
    mockChat.projectName = '我的小说';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<AppHeader pageKey="chat" />);
    });
    expect(headerTitle(tree.root)).toBe('我的小说');
  });

  it('会话列表态无项目时回退为「会话」', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<AppHeader pageKey="chat" />);
    });
    expect(headerTitle(tree.root)).toBe('会话');
  });

  it('项目工作区分段仍显示固定标题', () => {
    mockChat.sessionListPanel = 'template';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<AppHeader pageKey="chat" />);
    });
    expect(headerTitle(tree.root)).toBe('项目工作区');
  });

  it('对话态仍显示会话标题', () => {
    mockChat.chatSubview = 'conversation';
    mockChat.sessionTitle = '第一章讨论';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<AppHeader pageKey="chat" />);
    });
    expect(headerTitle(tree.root)).toBe('第一章讨论');
  });
});
