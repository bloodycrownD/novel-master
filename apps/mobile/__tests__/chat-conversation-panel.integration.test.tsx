import React, {useRef} from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';

const mockReload = jest.fn(async () => undefined);

jest.mock('../src/components/vfs/VfsFileManager', () => {
  const React = require('react');
  return {
    VfsFileManager: React.forwardRef(
      (_props: unknown, ref: React.Ref<{reload: () => Promise<void>}>) => {
        React.useImperativeHandle(ref, () => ({
          canGoUp: () => false,
          goUp: () => undefined,
          reload: mockReload,
        }));
        return null;
      },
    ),
  };
});

jest.mock('../src/components/chat/ChatComposer', () => ({
  ChatComposer: () => null,
}));
jest.mock('../src/components/chat/ChatMetaBar', () => ({
  ChatMetaBar: () => null,
}));
jest.mock('../src/components/chat/ChatStreamMetricsBarLive', () => ({
  ChatStreamMetricsBarLive: () => null,
}));
jest.mock('../src/components/chat/ChatTranscriptWebView', () => ({
  ChatTranscriptWebView: () => null,
}));
jest.mock('../src/components/chat/MessageList', () => ({
  MessageList: () => null,
}));
jest.mock('../src/components/batch/MessageBatchHeader', () => ({
  MessageBatchHeader: () => null,
}));
jest.mock('../src/components/chrome/SessionActionsDrawer', () => ({
  SessionActionsDrawer: () => null,
}));
jest.mock('../src/components/chat/MessageActionMenu', () => ({
  MessageActionMenu: () => null,
}));
jest.mock('../src/components/chat/MessageEditModal', () => ({
  MessageEditModal: () => null,
}));
jest.mock('../src/components/provider/ModelPickerModal', () => ({
  ModelPickerModal: () => null,
}));
jest.mock('../src/components/agent/AgentPickerModal', () => ({
  AgentPickerModal: () => null,
}));

import {ChatConversationPanel} from '../src/screens/tabs/chat-tab/ChatConversationPanel';
import type {VfsFileManagerHandle} from '../src/components/vfs/VfsFileManager';

const tokens = {
  background: '#000',
  surface: '#111',
  surfaceElevated: '#111',
  border: '#222',
  borderLight: '#222',
  text: '#fff',
  textSecondary: '#ccc',
  textTertiary: '#777',
  primary: '#08f',
  danger: '#f00',
  bgSecondary: '#222',
  headerBackground: '#111',
  tabBarBackground: '#111',
  tabBarActive: '#08f',
  tabBarInactive: '#666',
  overlay: 'rgba(0,0,0,0.5)',
  success: '#0a0',
  warning: '#fa0',
};

let mockConversationPanel: 'chat' | 'workspace' = 'chat';
const mockSetConversationPanel = jest.fn((panel: 'chat' | 'workspace') => {
  mockConversationPanel = panel;
});

function makeMockContext(workspaceVfsRef: React.RefObject<VfsFileManagerHandle | null>) {
  return {
    projectId: 'p1',
    sessionId: 's1',
    conversationPanel: mockConversationPanel,
    setConversationPanel: mockSetConversationPanel,
    chatSubview: 'conversation' as const,
    setChatSubview: jest.fn(),
    agentMeta: {agentId: 'a1', agentName: 'A', hasDedicatedModel: false},
    uiRunning: false,
    agentActive: false,
    activeRunId: null,
    streamTailGenerating: false,
    streamingText: '',
    streamingThinking: '',
    streamMetricsLastRun: null,
    streamMetricsAccRef: {current: null},
    onStreamReset: jest.fn(),
    chatMessages: [],
    hasMoreMessages: false,
    loadingMoreMessages: false,
    messageBatchActive: false,
    messageBatchMode: null,
    messageBatchSelectedIds: new Set<string>(),
    messageBatchSelectedCount: 0,
    onMessagesChanged: jest.fn(),
    canResumeWithoutInput: false,
    lastMessageHasToolResult: false,
    lastMessageIsPlainUserText: false,
    sessionVfs: {} as any,
    sessionWorktree: {} as any,
    vfsRefreshKey: 0,
    hasWorkspaceModel: false,
    bumpWorktreeUiToken: jest.fn(),
    chatScrollKey: 'p1:s1',
    cachedChatScroll: undefined,
    restoredTranscriptScroll: undefined,
    defaultChatScrollToBottom: true,
    onChatScrollSnapshot: jest.fn(),
    sessionDrawerOpen: false,
    setSessionDrawerOpen: jest.fn(),
    modelPickerOpen: false,
    setModelPickerOpen: jest.fn(),
    agentPickerOpen: false,
    setAgentPickerOpen: jest.fn(),
    messageMenuTarget: undefined,
    messageMenuAnchor: undefined,
    setMessageMenuTarget: jest.fn(),
    setMessageMenuAnchor: jest.fn(),
    messageEditPrompt: undefined,
    setMessageEditPrompt: jest.fn(),
    useWebviewTranscript: false,
    chatRichTextEnabled: false,
    richRenderEpoch: 0,
    webMenuCloseSignal: 0,
    webMenuOpen: false,
    setWebMenuOpen: jest.fn(),
    beginUiRun: jest.fn(),
    abortUiRun: jest.fn(),
    onLoadOlderMessages: jest.fn(),
    onOpenFileEditor: jest.fn(),
    onNeedModel: jest.fn(),
    onRefreshChatMeta: jest.fn(),
    exitMessageBatch: jest.fn(),
    transcriptWebRef: {current: null},
    workspaceVfsRef,
    scope: {
      sessionRenamePrompt: undefined,
      setSessionRenamePrompt: jest.fn(),
      refreshChatTokenLabel: jest.fn(),
      reloadLists: jest.fn(async () => undefined),
    },
    messageBatch: {
      active: false,
      mode: null,
      selectedIds: new Set<string>(),
      selectedCount: 0,
      enter: jest.fn(),
      exit: jest.fn(),
      toggle: jest.fn(),
      selectRange: jest.fn(),
      isSelected: jest.fn(() => false),
    },
    messages: {hydrateFromSessionCache: jest.fn()},
    resetStreamingDisplay: jest.fn(),
    navigation: {} as any,
    showToast: jest.fn(),
    runtime: {} as any,
    setCurrentSession: jest.fn(async () => undefined),
    closeMessageMenu: jest.fn(),
  };
}

jest.mock('../src/screens/tabs/chat-tab/ChatTabProvider', () => ({
  useChatTabContext: jest.fn(),
}));

jest.mock('../src/screens/tabs/chat-tab/useChatTabController', () => ({
  useChatTabController: () => ({
    handleToggleMessageSelect: jest.fn(),
    handleMessageLongPress: jest.fn(),
    handleMessageMenuSelect: jest.fn(),
    handleWebMessageMenuAction: jest.fn(),
    handleSaveMessageEdit: jest.fn(async () => undefined),
    confirmVisibilityBatch: jest.fn(),
    confirmTailBatch: jest.fn(),
    confirmBatchDeleteSessions: jest.fn(),
    handleOpenSessionRename: jest.fn(),
    handleCompactSession: jest.fn(),
    handleNavigateRealPrompt: jest.fn(),
    enterHideMessageBatch: jest.fn(),
    enterRestoreMessageBatch: jest.fn(),
    enterDeleteMessageBatch: jest.fn(),
    handleOpenSessionFilePreview: jest.fn(),
  }),
}));

jest.mock('../src/screens/tabs/chat-tab/ChatTabNavigationProvider', () => ({
  useChatTabWorkspaceBackState: () => jest.fn(),
}));

import {useChatTabContext} from '../src/screens/tabs/chat-tab/ChatTabProvider';

const mockUseChatTabContext = useChatTabContext as jest.MockedFunction<
  typeof useChatTabContext
>;

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function TestHost() {
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  mockUseChatTabContext.mockReturnValue(
    makeMockContext(workspaceVfsRef) as ReturnType<typeof useChatTabContext>,
  );
  return <ChatConversationPanel tokens={tokens} visible />;
}

describe('ChatConversationPanel workspace reload', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockReload.mockClear();
    mockConversationPanel = 'chat';
  });

  afterEach(() => {
    if (tree != null) {
      act(() => {
        tree!.unmount();
      });
    }
    tree = undefined;
  });

  it('切入 workspace 时调用 VfsFileManager.reload()', async () => {
    mockConversationPanel = 'workspace';
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });

    expect(mockReload).toHaveBeenCalled();
  });

  it('chat → workspace 切换时再次 reload()', async () => {
    mockConversationPanel = 'chat';
    await act(async () => {
      tree = TestRenderer.create(<TestHost />);
      await flushPromises();
    });
    mockReload.mockClear();

    mockConversationPanel = 'workspace';
    await act(async () => {
      tree!.update(<TestHost />);
      await flushPromises();
    });

    expect(mockReload).toHaveBeenCalled();
  });
});
