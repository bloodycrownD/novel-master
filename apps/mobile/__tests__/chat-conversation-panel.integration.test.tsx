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
};

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function TestHost({
  conversationPanel,
  onConversationPanelChange,
}: {
  conversationPanel: 'chat' | 'workspace';
  onConversationPanelChange: (panel: 'chat' | 'workspace') => void;
}) {
  const workspaceVfsRef = useRef<VfsFileManagerHandle>(null);
  return (
    <ChatConversationPanel
      tokens={tokens}
      visible
      conversationPanel={conversationPanel}
      onConversationPanelChange={onConversationPanelChange}
      projectId="p1"
      sessionId="s1"
      agentMeta={{agentId: 'a1', agentName: 'A', hasDedicatedModel: false}}
      streamMetricsAccRef={{current: null}}
      streamMetricsLastRun={null}
      streamTailGenerating={false}
      uiRunning={false}
      agentActive={false}
      messageBatchActive={false}
      messageBatchMode={null}
      messageBatchSelectedCount={0}
      messageBatchSelectedIds={new Set()}
      onExitMessageBatch={jest.fn()}
      onConfirmVisibilityBatch={jest.fn()}
      useWebviewTranscript={false}
      transcriptWebRef={{current: null}}
      chatScrollKey="p1:s1"
      chatMessages={[]}
      hasMoreMessages={false}
      transcriptFlags={{
        richText: false,
        batchMode: false,
        batchModeKind: null,
      }}
      webMenuCloseSignal={0}
      restoredTranscriptScroll={undefined}
      defaultChatScrollToBottom
      cachedChatScroll={undefined}
      streamingText=""
      streamingThinking=""
      chatRichTextEnabled={false}
      richRenderEpoch={0}
      loadingMoreMessages={false}
      hasWorkspaceModel={false}
      canResumeWithoutInput={false}
      lastMessageHasToolResult={false}
      lastMessageIsPlainUserText={false}
      vfsRefreshKey={0}
      sessionVfs={{} as any}
      sessionWorktree={{} as any}
      sessionDrawerOpen={false}
      onCloseSessionDrawer={jest.fn()}
      onOpenSessionRename={jest.fn()}
      onCompactSession={jest.fn()}
      onNavigateRealPrompt={jest.fn()}
      onEnterHideMessageBatch={jest.fn()}
      onEnterRestoreMessageBatch={jest.fn()}
      onEnterDeleteMessageBatch={jest.fn()}
      modelPickerOpen={false}
      agentPickerOpen={false}
      onCloseModelPicker={jest.fn()}
      onCloseAgentPicker={jest.fn()}
      onRefreshChatMeta={jest.fn()}
      messageMenuTarget={undefined}
      messageMenuAnchor={undefined}
      messageMenuItems={[]}
      useWebviewMessageMenu={false}
      onCloseMessageMenu={jest.fn()}
      onMessageMenuSelect={jest.fn()}
      messageEditPrompt={undefined}
      onCloseMessageEdit={jest.fn()}
      onSaveMessageEdit={jest.fn(async () => undefined)}
      onChatScrollSnapshot={jest.fn()}
      onLoadOlderMessages={jest.fn(async () => undefined)}
      onOpenSessionFilePreview={jest.fn()}
      onWebMenuOpenChange={jest.fn()}
      onWebMessageMenuAction={jest.fn()}
      onToggleMessageSelect={jest.fn()}
      onMessageLongPress={jest.fn()}
      beginUiRun={jest.fn()}
      abortUiRun={jest.fn()}
      onStreamReset={jest.fn()}
      onMessagesChanged={jest.fn()}
      onNeedModel={jest.fn()}
      bumpWorktreeUiToken={jest.fn()}
      onOpenFileEditor={jest.fn()}
      workspaceVfsRef={workspaceVfsRef}
    />
  );
}

describe('ChatConversationPanel workspace reload', () => {
  let tree: TestRenderer.ReactTestRenderer | undefined;

  beforeEach(() => {
    mockReload.mockClear();
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
    await act(async () => {
      tree = TestRenderer.create(
        <TestHost
          conversationPanel="workspace"
          onConversationPanelChange={jest.fn()}
        />,
      );
      await flushPromises();
    });

    expect(mockReload).toHaveBeenCalled();
  });

  it('chat → workspace 切换时再次 reload()', async () => {
    await act(async () => {
      tree = TestRenderer.create(
        <TestHost conversationPanel="chat" onConversationPanelChange={jest.fn()} />,
      );
      await flushPromises();
    });
    mockReload.mockClear();

    await act(async () => {
      tree!.update(
        <TestHost
          conversationPanel="workspace"
          onConversationPanelChange={jest.fn()}
        />,
      );
      await flushPromises();
    });

    expect(mockReload).toHaveBeenCalled();
  });
});
