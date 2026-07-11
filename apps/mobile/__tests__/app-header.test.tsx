import React from 'react';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import TestRenderer, { act } from 'react-test-renderer';
import { AppHeader } from '../src/components/chrome/AppHeader';
import type { ChatTabNavigationContextValue } from '../src/screens/tabs/chat-tab/ChatTabNavigationProvider';

const mockNavState = {
  chatSubview: 'list' as 'list' | 'conversation',
  sessionListPanel: 'sessions' as 'sessions' | 'projects',
  projectName: undefined as string | undefined,
  sessionTitle: undefined as string | undefined,
  sessionDrawerOpen: false,
  projectDrawerOpen: false,
  sessionBatchActive: false,
  workspaceCanGoUp: false,
};

const mockChatNav: ChatTabNavigationContextValue = {
  state: mockNavState,
  actions: {
    backFromConversation: jest.fn(),
    showChatPanel: jest.fn(),
    closeSessionDrawer: jest.fn(),
    closeProjectDrawer: jest.fn(),
    showSessionsPanel: jest.fn(),
    openDrawer: jest.fn(),
    closeMessageMenu: jest.fn(),
    closeMessageEdit: jest.fn(),
    closeModelPicker: jest.fn(),
    closeAgentPicker: jest.fn(),
    closeSessionRename: jest.fn(),
    exitSessionBatch: jest.fn(),
    workspaceGoUp: undefined,
  },
};

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
  useHeaderContext: () => ({ chat: undefined, stackOverride: undefined }),
}));

jest.mock('../src/screens/tabs/chat-tab/ChatTabNavigationProvider', () => ({
  useChatTabNavigationOptional: () => mockChatNav,
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
    Pressable: ({ children, ...props }: { children?: React.ReactNode }) =>
      mockReact.createElement('Pressable', props, children),
    StyleSheet: {
      hairlineWidth: 1,
      create: (s: object) => s,
    },
    Text: ({ children, ...props }: { children?: React.ReactNode }) =>
      mockReact.createElement('Text', props, children),
    View: ({ children, ...props }: { children?: React.ReactNode }) =>
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
    mockNavState.chatSubview = 'list';
    mockNavState.sessionListPanel = 'sessions';
    mockNavState.projectName = undefined;
    mockNavState.sessionTitle = undefined;
  });

  it('会话列表态显示当前项目名称', () => {
    mockNavState.projectName = '我的小说';
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
    mockNavState.sessionListPanel = 'projects';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<AppHeader pageKey="chat" />);
    });
    expect(headerTitle(tree.root)).toBe('项目工作区');
  });

  it('对话态仍显示会话标题', () => {
    mockNavState.chatSubview = 'conversation';
    mockNavState.sessionTitle = '第一章讨论';
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<AppHeader pageKey="chat" />);
    });
    expect(headerTitle(tree.root)).toBe('第一章讨论');
  });
});
