/**
 * Chat tab: session list / template sub-tabs, conversation workspace (M1 skeleton).
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  EVENT_SESSION_COMPACTION_REQUESTED,
  textBlocks,
  type ChatMessage,
  type ChatProject,
  type ChatSession,
} from '@novel-master/core';
import {AppHeader} from '../../components/chrome/AppHeader';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {ChatComposer} from '../../components/chat/ChatComposer';
import {ChatMetaBar} from '../../components/chat/ChatMetaBar';
import {
  buildMessageActionItems,
  editableTextFromMessage,
} from '../../components/chat/message-edit';
import {
  MessageActionMenu,
  type MessageMenuAnchor,
} from '../../components/chat/MessageActionMenu';
import {MessageList} from '../../components/chat/MessageList';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ProjectDrawer} from '../../components/chrome/ProjectDrawer';
import {SessionActionsDrawer} from '../../components/chrome/SessionActionsDrawer';
import {AgentPickerModal} from '../../components/agent/AgentPickerModal';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {VfsFileManager} from '../../components/vfs/VfsFileManager';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {PrimaryButton} from '../../components/ui/PrototypeButtons';
import {useAndroidChatBackHandler} from '../../hooks/useAndroidChatBackHandler';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {formatRelativeTimeMs} from '../../utils/format-relative-time';
import {nextDefaultSessionTitle} from '../../utils/session-default-title';
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useRuntime} from '../../hooks/useRuntime';
import {useMobileScope} from '../../hooks/useMobileScope';
import {
  loadChatAgentMeta,
  type ChatAgentMeta,
} from '../../services/chat-agent-meta';
import {loadChatPromptTokenLabelResilient} from '../../services/chat-prompt-tokens.service';
import {
  loadSessionMessagesPageForDisplay,
  loadSessionMessagesTailForDisplay,
} from '../../services/regex-apply-channel';
import {prependOlderMessages} from '../../services/message-paging';
import {readChatRichTextEnabled} from '../../storage/chat-rich-text-pref';
import {APP_UI_KEY_SHOW_FULL_TOOL_PARAMS} from '../../storage/app-ui-keys';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {useTheme} from '../../theme/ThemeProvider';
import {createStreamBuffer} from '../../services/stream-buffer.service';
import {rollbackToMessage} from '../../services/message-rollback.service';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type SessionListPanel = 'sessions' | 'template';
type ChatSubview = 'sessions' | 'conversation';
type ConversationPanel = 'chat' | 'workspace';
type MessageBatchPurpose = 'delete' | 'hide' | 'unhide';
const CHAT_PAGE_SIZE = 40;

export function ChatTabScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {projectId, sessionId, setCurrentProject, setCurrentSession, refreshScope} =
    useMobileScope();
  const {setChat} = useHeaderContext();
  const navigation = useNavigation<Nav>();

  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentProject, setCurrentProjectMeta] = useState<ChatProject | undefined>();
  const [sessionListPanel, setSessionListPanel] =
    useState<SessionListPanel>('sessions');
  const [chatSubview, setChatSubview] = useState<ChatSubview>('sessions');
  const [conversationPanel, setConversationPanel] =
    useState<ConversationPanel>('chat');
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false);
  const sessionBatch = useBatchSelection();
  const messageBatch = useBatchSelection();
  const {appUi} = useNovelMaster();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [agentMeta, setAgentMeta] = useState<ChatAgentMeta>({
    agentId: undefined,
    agentName: '—',
    modelLabel: '—',
    tokenLabel: '',
    hasDedicatedModel: false,
  });
  const [hasWorkspaceModel, setHasWorkspaceModel] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const streamBuffer = useMemo(
    () =>
      createStreamBuffer({
        onTextFlush: delta => setStreamingText(prev => prev + delta),
        onThinkingFlush: delta => setStreamingThinking(prev => prev + delta),
      }),
    [],
  );
  const [showFullToolParams, setShowFullToolParams] = useState(false);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [vfsRefreshKey, setVfsRefreshKey] = useState(0);
  const [menuSessionId, setMenuSessionId] = useState<string | undefined>();
  const [sessionRenamePrompt, setSessionRenamePrompt] = useState<
    {sessionId: string; initialTitle: string} | undefined
  >();
  const [messageMenuTarget, setMessageMenuTarget] = useState<
    ChatMessage | undefined
  >();
  const [messageMenuAnchor, setMessageMenuAnchor] = useState<
    MessageMenuAnchor | undefined
  >();
  const [messageBatchPurpose, setMessageBatchPurpose] = useState<
    MessageBatchPurpose | null
  >(null);
  const [messageEditPrompt, setMessageEditPrompt] = useState<
    {messageId: string; initialText: string} | undefined
  >();

  const reloadLists = useCallback(async () => {
    const plist = await runtime.projects.list();
    setProjects(plist);
    const pid = projectId ?? plist[0]?.id;
    if (pid) {
      try {
        setCurrentProjectMeta(await runtime.projects.get(pid));
      } catch {
        setCurrentProjectMeta(undefined);
      }
      setSessions(await runtime.sessions.listByProject(pid));
    } else {
      setCurrentProjectMeta(undefined);
      setSessions([]);
    }
  }, [runtime, projectId]);

  useEffect(() => {
    reloadLists().catch(() => undefined);
  }, [reloadLists]);

  const currentSession = sessions.find(s => s.id === sessionId);
  const canResumeWithoutInput =
    chatMessages.length > 0 && chatMessages[chatMessages.length - 1]?.role === 'user';

  const refreshChatMeta = useCallback(async () => {
    const modelId = await runtime.state.getCurrentModelId();
    setHasWorkspaceModel(modelId != null && modelId !== '');
    try {
      const meta = await loadChatAgentMeta(runtime);
      setAgentMeta({...meta, tokenLabel: '…'});
      if (projectId != null && sessionId != null) {
        const tokenLabel = await loadChatPromptTokenLabelResilient(runtime, {
          projectId,
          sessionId,
        });
        setAgentMeta(prev => ({...prev, tokenLabel}));
      } else {
        setAgentMeta(prev => ({...prev, tokenLabel: ''}));
      }
    } catch {
      setAgentMeta({
        agentId: undefined,
        agentName: '—',
        modelLabel: '—',
        tokenLabel: '',
        hasDedicatedModel: false,
      });
    }
  }, [runtime, projectId, sessionId]);

  const reloadMessages = useCallback(async () => {
    if (sessionId == null) {
      setChatMessages([]);
      setHasMoreMessages(false);
      return;
    }
    const list = await loadSessionMessagesTailForDisplay(
      runtime,
      sessionId,
      CHAT_PAGE_SIZE,
    );
    setChatMessages(list);
    const oldestSeq = list[0]?.seq;
    if (oldestSeq == null) {
      setHasMoreMessages(false);
    } else {
      const older = await runtime.messages.listBySessionPage(sessionId, {
        limit: 1,
        beforeSeq: oldestSeq,
      });
      setHasMoreMessages(older.length > 0);
    }
  }, [runtime, sessionId]);

  const handleStreamText = useCallback(
    (delta: string) => {
      streamBuffer.push('text', delta);
    },
    [streamBuffer],
  );

  const handleStreamThinking = useCallback(
    (delta: string) => {
      streamBuffer.push('thinking', delta);
    },
    [streamBuffer],
  );

  const handleStreamReset = useCallback(() => {
    streamBuffer.flush();
    streamBuffer.reset();
    setStreamingText('');
    setStreamingThinking('');
  }, [streamBuffer]);

  const handleMessagesChanged = useCallback(async () => {
    await reloadMessages();
    await refreshChatMeta();
  }, [reloadMessages, refreshChatMeta]);

  const loadOlderMessages = useCallback(async () => {
    if (sessionId == null || loadingMoreMessages || chatMessages.length === 0) {
      return;
    }
    setLoadingMoreMessages(true);
    try {
      const beforeSeq = chatMessages[0]?.seq;
      if (beforeSeq == null) {
        return;
      }
      const older = await loadSessionMessagesPageForDisplay(runtime, sessionId, {
        limit: CHAT_PAGE_SIZE,
        beforeSeq,
      });
      if (older.length === 0) {
        setHasMoreMessages(false);
        return;
      }
      setChatMessages(prev => prependOlderMessages(prev, older));
      setHasMoreMessages(older.length === CHAT_PAGE_SIZE);
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [runtime, sessionId, loadingMoreMessages, chatMessages]);

  useEffect(() => {
    return () => {
      streamBuffer.dispose();
    };
  }, [streamBuffer]);

  useEffect(() => {
    if (chatSubview === 'conversation' && sessionId != null) {
      reloadMessages().catch(() => undefined);
      refreshChatMeta().catch(() => undefined);
    }
  }, [chatSubview, sessionId, reloadMessages, refreshChatMeta]);

  useEffect(() => {
    if (!appUi) {
      return;
    }
    appUi
      .get(APP_UI_KEY_SHOW_FULL_TOOL_PARAMS)
      .then(v => setShowFullToolParams(v === 'true'))
      .catch(() => undefined);
  }, [appUi]);

  const refreshChatRichTextPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setChatRichTextEnabled(await readChatRichTextEnabled(appUi));
  }, [appUi]);

  useFocusEffect(
    useCallback(() => {
      refreshChatRichTextPref().catch(() => undefined);
    }, [refreshChatRichTextPref]),
  );

  const backFromConversation = useCallback(
    () => setChatSubview('sessions'),
    [],
  );

  const closeMessageMenu = useCallback(() => {
    setMessageMenuTarget(undefined);
    setMessageMenuAnchor(undefined);
  }, []);

  useAndroidChatBackHandler(
    {
      chatSubview,
      sessionListPanel,
      sessionDrawerOpen,
      messageMenuOpen: messageMenuTarget != null,
      messageBatchActive: messageBatch.active,
      messageEditOpen: messageEditPrompt != null,
      modelPickerOpen,
      agentPickerOpen,
      sessionRenameOpen: sessionRenamePrompt != null,
      projectDrawerOpen,
      sessionBatchActive: sessionBatch.active,
    },
    {
      backFromConversation,
      closeSessionDrawer: () => setSessionDrawerOpen(false),
      closeMessageMenu,
      exitMessageBatch: messageBatch.exit,
      closeMessageEdit: () => setMessageEditPrompt(undefined),
      closeModelPicker: () => setModelPickerOpen(false),
      closeAgentPicker: () => setAgentPickerOpen(false),
      closeSessionRename: () => setSessionRenamePrompt(undefined),
      closeProjectDrawer: () => setProjectDrawerOpen(false),
      exitSessionBatch: sessionBatch.exit,
      showSessionsPanel: () => setSessionListPanel('sessions'),
    },
  );

  useEffect(() => {
    setChat({
      chatSubview,
      sessionListPanel,
      sessionTitle: currentSession?.title ?? currentSession?.id,
      agentName: chatSubview === 'conversation' ? agentMeta.agentName : undefined,
      modelLabel:
        chatSubview === 'conversation' ? agentMeta.modelLabel : undefined,
      onBackFromConversation: backFromConversation,
      onOpenDrawer: () => {
        if (chatSubview === 'conversation') {
          setSessionDrawerOpen(true);
        } else {
          setProjectDrawerOpen(true);
        }
      },
    });
  }, [
    chatSubview,
    sessionListPanel,
    currentSession,
    agentMeta,
    setChat,
    backFromConversation,
  ]);

  const openConversation = useCallback(
    async (sid: string) => {
      if (projectId == null) {
        return;
      }
      await setCurrentSession(sid);
      setChatSubview('conversation');
      setConversationPanel('chat');
    },
    [projectId, setCurrentSession],
  );

  const handleCreateProject = useCallback(
    async (name: string) => {
      try {
        const created = await runtime.projects.create(name);
        await setCurrentProject(created.id);
        await refreshScope();
        await reloadLists();
      } catch (error) {
        showToast(toastMessage('创建失败', error));
      }
    },
    [runtime, setCurrentProject, refreshScope, reloadLists, showToast],
  );

  const handleRenameProject = useCallback(
    async (projectId: string, name: string) => {
      try {
        await runtime.projects.rename(projectId, name);
        await reloadLists();
      } catch (error) {
        showToast(toastMessage('重命名失败', error));
      }
    },
    [runtime, reloadLists, showToast],
  );

  const handleCreateSession = useCallback(async () => {
    if (projectId == null) {
      return;
    }
    try {
      const list = await runtime.sessions.listByProject(projectId);
      const title = nextDefaultSessionTitle(list.map(s => s.title));
      await runtime.sessions.create(projectId, title);
      await reloadLists();
    } catch (error) {
      showToast(toastMessage('创建失败', error));
    }
  }, [runtime, projectId, reloadLists, showToast]);

  const handleRenameSession = useCallback(
    async (targetSessionId: string, title: string) => {
      try {
        await runtime.sessions.rename(targetSessionId, title);
        await reloadLists();
      } catch (error) {
        showToast(toastMessage('重命名失败', error));
      }
    },
    [runtime, reloadLists, showToast],
  );

  const openSessionRenamePrompt = useCallback(
    (targetSessionId: string) => {
      const session = sessions.find(s => s.id === targetSessionId);
      setSessionRenamePrompt({
        sessionId: targetSessionId,
        initialTitle: session?.title ?? '',
      });
    },
    [sessions],
  );

  const deleteSelectedSessions = useCallback(async () => {
    const ids = [...sessionBatch.selectedIds];
    for (const id of ids) {
      await runtime.sessions.delete(id);
    }
    const deletedCurrent = sessionId != null && ids.includes(sessionId);
    sessionBatch.exit();
    if (deletedCurrent) {
      setChatSubview('sessions');
    }
    await refreshScope();
    await reloadLists();
  }, [runtime, sessionBatch, sessionId, refreshScope, reloadLists]);

  const handleCopySession = useCallback(
    async (sourceSessionId: string) => {
      try {
        const copy = await runtime.sessions.copy(sourceSessionId);
        await reloadLists();
        showToast(`已复制会话：${copy.title ?? copy.id}`);
      } catch (error) {
        showToast(toastMessage('复制失败', error));
      }
    },
    [runtime, reloadLists, showToast],
  );

  const handleDeleteSession = useCallback(
    async (targetSessionId: string) => {
      try {
        await runtime.sessions.delete(targetSessionId);
        if (sessionId === targetSessionId) {
          setChatSubview('sessions');
        }
        await refreshScope();
        await reloadLists();
        showToast('已删除会话');
      } catch (error) {
        showToast(toastMessage('删除失败', error));
      }
    },
    [runtime, sessionId, refreshScope, reloadLists, showToast],
  );

  const confirmDeleteSession = useCallback(
    (targetSessionId: string) => {
      const session = sessions.find(s => s.id === targetSessionId);
      const label = session?.title?.trim() || '该会话';
      Alert.alert(
        '确认删除',
        `确定删除会话「${label}」？消息与文件将一并删除，且无法恢复。`,
        [
          {text: '取消', style: 'cancel'},
          {
            text: '删除',
            style: 'destructive',
            onPress: () => handleDeleteSession(targetSessionId).catch(() => undefined),
          },
        ],
      );
    },
    [sessions, handleDeleteSession],
  );

  const bumpVfsRefresh = useCallback(() => {
    setVfsRefreshKey(key => key + 1);
  }, []);

  const handleForkFromMessage = useCallback(
    async (messageId: string) => {
      if (sessionId == null) {
        return;
      }
      if (agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法 Fork'));
        return;
      }
      try {
        const forked = await runtime.messages.fork(sessionId, messageId);
        await reloadLists();
        await setCurrentSession(forked.id);
        setChatSubview('conversation');
        setConversationPanel('chat');
        setStreamingText('');
        setStreamingThinking('');
        bumpVfsRefresh();
        showToast(`已 Fork：${forked.title ?? forked.id}`);
      } catch (error) {
        showToast(toastMessage('Fork 失败', error));
      }
    },
    [
      sessionId,
      agentRunning,
      runtime,
      reloadLists,
      setCurrentSession,
      bumpVfsRefresh,
      showToast,
    ],
  );

  const handleRollbackFromMessage = useCallback(
    (messageId: string) => {
      if (sessionId == null || projectId == null) {
        return;
      }
      if (agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法回滚'));
        return;
      }
      Alert.alert(
        '回滚到此消息',
        '将删除此消息之后的对话，并撤销相关文件修改。是否继续？',
        [
          {text: '取消', style: 'cancel'},
          {
            text: '回滚',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await rollbackToMessage(runtime, {projectId, sessionId}, messageId);
                  setStreamingText('');
                  setStreamingThinking('');
                  await reloadMessages();
                  bumpVfsRefresh();
                  showToast('回滚成功');
                } catch (error) {
                  showToast(toastMessage('回滚失败', error));
                }
              })();
            },
          },
        ],
      );
    },
    [
      sessionId,
      projectId,
      agentRunning,
      runtime,
      reloadMessages,
      bumpVfsRefresh,
      showToast,
    ],
  );

  const exitMessageBatch = useCallback(() => {
    messageBatch.exit();
    setMessageBatchPurpose(null);
  }, [messageBatch]);

  const enterMessageBatch = useCallback(
    (purpose: MessageBatchPurpose) => {
      if (agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法批量操作消息'));
        return;
      }
      messageBatch.exit();
      setMessageBatchPurpose(purpose);
      messageBatch.enter();
    },
    [agentRunning, messageBatch, showToast],
  );

  const deleteSelectedMessages = useCallback(async () => {
    const ids = [...messageBatch.selectedIds];
    for (const id of ids) {
      await runtime.messages.delete(id);
    }
    exitMessageBatch();
    setStreamingText('');
    setStreamingThinking('');
    await reloadMessages();
  }, [runtime, messageBatch, exitMessageBatch, reloadMessages]);

  const hideSelectedMessages = useCallback(async () => {
    const ids = [...messageBatch.selectedIds];
    for (const id of ids) {
      await runtime.messages.hide(id);
    }
    exitMessageBatch();
    await reloadMessages();
  }, [runtime, messageBatch, exitMessageBatch, reloadMessages]);

  const unhideSelectedMessages = useCallback(async () => {
    const ids = [...messageBatch.selectedIds];
    for (const id of ids) {
      await runtime.messages.show(id);
    }
    exitMessageBatch();
    await reloadMessages();
  }, [runtime, messageBatch, exitMessageBatch, reloadMessages]);

  const confirmMessageBatchDelete = useCallback(() => {
    const count = messageBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert(
      '确认删除',
      `确定删除选中的 ${count} 条消息？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteSelectedMessages().catch(() => undefined),
        },
      ],
    );
  }, [messageBatch.selectedCount, deleteSelectedMessages]);

  const confirmBatchHideMessages = useCallback(() => {
    const count = messageBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert(
      '确认隐藏',
      `确定隐藏选中的 ${count} 条消息？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '隐藏',
          onPress: () => hideSelectedMessages().catch(() => undefined),
        },
      ],
    );
  }, [messageBatch.selectedCount, hideSelectedMessages]);

  const confirmBatchUnhideMessages = useCallback(() => {
    const count = messageBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert(
      '确认取消隐藏',
      `确定取消隐藏选中的 ${count} 条消息？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '取消隐藏',
          onPress: () => unhideSelectedMessages().catch(() => undefined),
        },
      ],
    );
  }, [messageBatch.selectedCount, unhideSelectedMessages]);

  const handleHideMessage = useCallback(
    async (messageId: string) => {
      try {
        await runtime.messages.hide(messageId);
        await reloadMessages();
      } catch (error) {
        showToast(toastMessage('隐藏失败', error));
      }
    },
    [runtime, reloadMessages, showToast],
  );

  const handleShowMessage = useCallback(
    async (messageId: string) => {
      try {
        await runtime.messages.show(messageId);
        await reloadMessages();
      } catch (error) {
        showToast(toastMessage('取消隐藏失败', error));
      }
    },
    [runtime, reloadMessages, showToast],
  );

  const handleCompactSession = useCallback(() => {
    if (agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法压缩'));
      return;
    }
    if (projectId == null || sessionId == null) {
      return;
    }
    Alert.alert(
      '压缩会话',
      '将按默认配置隐藏自尾深度 6 及以上的可见消息，并刷新宏。是否继续？',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '压缩',
          onPress: () => {
            void (async () => {
              try {
                const result = await runtime.eventOrchestrator.emit(
                  EVENT_SESSION_COMPACTION_REQUESTED,
                  {sessionId, projectId, trigger: 'manual'},
                );
                await reloadMessages();
                if (!result.ok) {
                  showToast(toastMessage('压缩部分失败', result.failures[0]?.error));
                } else {
                  showToast('已压缩');
                }
              } catch (error) {
                showToast(toastMessage('压缩失败', error));
              }
            })();
          },
        },
      ],
    );
  }, [
    agentRunning,
    projectId,
    sessionId,
    runtime.eventOrchestrator,
    reloadMessages,
    showToast,
  ]);

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      try {
        await runtime.messages.delete(messageId);
        setStreamingText('');
        setStreamingThinking('');
        await reloadMessages();
      } catch (error) {
        showToast(toastMessage('删除失败', error));
      }
    },
    [runtime, reloadMessages, showToast],
  );

  const handleSaveMessageEdit = useCallback(
    async (messageId: string, text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') {
        showToast(toastMessage('无法保存', '消息内容不能为空'));
        return;
      }
      try {
        await runtime.messages.updateContent(messageId, textBlocks(trimmed));
        await reloadMessages();
      } catch (error) {
        showToast(toastMessage('保存失败', error));
      }
    },
    [runtime, reloadMessages, showToast],
  );

  const confirmBatchDelete = useCallback(() => {
    const count = sessionBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert(
      '确认删除',
      `确定删除选中的 ${count} 个会话？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => deleteSelectedSessions(),
        },
      ],
    );
  }, [sessionBatch.selectedCount, deleteSelectedSessions]);

  const handleDeleteProjects = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        await runtime.projects.delete(id);
      }
      await refreshScope();
      await reloadLists();
    },
    [runtime, refreshScope, reloadLists],
  );

  const openFileEditor = useCallback(
    (
      path: string,
      scopeKind: 'project' | 'session',
    ) => {
      if (projectId == null) {
        return;
      }
      if (scopeKind === 'session') {
        if (sessionId == null) {
          return;
        }
        navigation.navigate('FileEditor', {
          path,
          scopeKind: 'session',
          projectId,
          sessionId,
        });
      } else {
        navigation.navigate('FileEditor', {
          path,
          scopeKind: 'project',
          projectId,
        });
      }
    },
    [navigation, projectId, sessionId],
  );

  const sessionVfs =
    projectId != null && sessionId != null
      ? runtime.sessionVfs(projectId, sessionId)
      : null;
  const sessionWorktree =
    projectId != null && sessionId != null
      ? runtime.worktree({
          kind: 'session',
          projectId,
          sessionId,
        })
      : null;
  const projectVfs =
    projectId != null ? runtime.projectVfs(projectId) : null;
  const projectWorktree =
    projectId != null
      ? runtime.worktree({kind: 'project', projectId})
      : null;

  const sessionRenameModal = (
    <TextPromptModal
      visible={sessionRenamePrompt != null}
      title="重命名会话"
      label="会话名称"
      placeholder="输入会话名称"
      initialValue={sessionRenamePrompt?.initialTitle ?? ''}
      confirmLabel="保存"
      onClose={() => setSessionRenamePrompt(undefined)}
      onConfirm={async value => {
        const prompt = sessionRenamePrompt;
        setSessionRenamePrompt(undefined);
        if (prompt) {
          await handleRenameSession(prompt.sessionId, value);
        }
      }}
    />
  );

  if (chatSubview === 'conversation') {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <AppHeader pageKey="chat" />
        <SegmentedControl
          tokens={tokens}
          value={conversationPanel}
          onChange={setConversationPanel}
          options={[
            {value: 'chat', label: '聊天'},
            {value: 'workspace', label: '会话工作区'},
          ]}
        />
        {conversationPanel === 'chat' ? (
          projectId != null && sessionId != null ? (
            <View style={styles.chatPanel}>
              <ChatMetaBar meta={agentMeta} />
              {messageBatch.active ? (
                <ManageHeader
                  title="消息"
                  batchMode
                  selectedCount={messageBatch.selectedCount}
                  onEnterBatch={() => undefined}
                  onCancelBatch={exitMessageBatch}
                  primaryActionLabel={
                    messageBatchPurpose === 'hide'
                      ? '隐藏'
                      : messageBatchPurpose === 'unhide'
                        ? '取消隐藏'
                        : '删除'
                  }
                  onPrimaryAction={
                    messageBatchPurpose === 'hide'
                      ? confirmBatchHideMessages
                      : messageBatchPurpose === 'unhide'
                        ? confirmBatchUnhideMessages
                        : confirmMessageBatchDelete
                  }
                  primaryActionTone={
                    messageBatchPurpose === 'delete' ? 'danger' : 'primary'
                  }
                  hint={
                    messageBatchPurpose === 'hide'
                      ? '选择要隐藏的消息'
                      : messageBatchPurpose === 'unhide'
                        ? '选择要取消隐藏的消息'
                        : '选择要删除的消息'
                  }
                />
              ) : null}
              <MessageList
                messages={chatMessages}
                streamingText={streamingText}
                streamingThinking={streamingThinking}
                showFullToolParams={showFullToolParams}
                chatRichTextEnabled={chatRichTextEnabled}
                batchMode={messageBatch.active}
                selectedMessageIds={messageBatch.selectedIds}
                onToggleMessageSelect={messageBatch.toggle}
                onMessageLongPress={(msg, anchor) => {
                  if (agentRunning) {
                    return;
                  }
                  setMessageMenuTarget(msg);
                  setMessageMenuAnchor(anchor);
                }}
              />
              {hasMoreMessages ? (
                <Pressable
                  style={styles.loadMoreBtn}
                  onPress={() => loadOlderMessages().catch(() => undefined)}>
                  <Text style={{color: tokens.primary}}>
                    {loadingMoreMessages ? '加载中…' : '加载更早消息'}
                  </Text>
                </Pressable>
              ) : null}
              <ChatComposer
                scope={{projectId, sessionId}}
                hasModel={hasWorkspaceModel || agentMeta.hasDedicatedModel}
                running={agentRunning}
                onRunningChange={setAgentRunning}
                onStreamText={handleStreamText}
                onStreamThinking={handleStreamThinking}
                onStreamReset={handleStreamReset}
                onMessagesChanged={handleMessagesChanged}
                onNeedModel={() => setModelPickerOpen(true)}
                canResumeWithoutInput={canResumeWithoutInput}
              />
            </View>
          ) : (
            <View style={styles.placeholder}>
              <Text style={{color: tokens.textSecondary}}>请先选择会话</Text>
            </View>
          )
        ) : sessionVfs && sessionWorktree && sessionId != null ? (
          <View style={styles.flexFill}>
            <VfsFileManager
              key={`session-vfs-${vfsRefreshKey}`}
              scope={{
                kind: 'session',
                projectId: projectId!,
                sessionId,
              }}
              vfs={sessionVfs}
              worktree={sessionWorktree}
              rootPath="/"
              pullFromParent={{
                scope: {kind: 'session', sessionId},
                onPulled: bumpVfsRefresh,
              }}
              onOpenFile={path => openFileEditor(path, 'session')}
            />
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Text style={{color: tokens.textSecondary}}>请先选择会话</Text>
          </View>
        )}
        <SessionActionsDrawer
          visible={sessionDrawerOpen}
          onClose={() => setSessionDrawerOpen(false)}
          onRename={() => {
            if (sessionId != null) {
              setSessionDrawerOpen(false);
              openSessionRenamePrompt(sessionId);
            }
          }}
          onCompact={() => {
            setSessionDrawerOpen(false);
            handleCompactSession();
          }}
          onSwitchModel={() => {
            setSessionDrawerOpen(false);
            setModelPickerOpen(true);
          }}
          onSwitchAgent={() => {
            setSessionDrawerOpen(false);
            setAgentPickerOpen(true);
          }}
          onRealPrompt={() => navigation.navigate('RealPrompt')}
          onBatchDeleteMessages={() => {
            setSessionDrawerOpen(false);
            enterMessageBatch('delete');
          }}
          onBatchHideMessages={() => {
            setSessionDrawerOpen(false);
            enterMessageBatch('hide');
          }}
          onBatchUnhideMessages={() => {
            setSessionDrawerOpen(false);
            enterMessageBatch('unhide');
          }}
        />
        <MessageActionMenu
          visible={messageMenuTarget != null}
          anchor={messageMenuAnchor}
          items={
            messageMenuTarget != null
              ? buildMessageActionItems(messageMenuTarget)
              : []
          }
          onClose={() => {
            setMessageMenuTarget(undefined);
            setMessageMenuAnchor(undefined);
          }}
          onSelect={action => {
            const target = messageMenuTarget;
            setMessageMenuTarget(undefined);
            setMessageMenuAnchor(undefined);
            if (target == null) {
              return;
            }
            if (action === 'edit') {
              const initial = editableTextFromMessage(target);
              if (initial == null) {
                showToast(toastMessage('无法编辑', '该消息包含工具调用，暂不支持编辑'));
                return;
              }
              setMessageEditPrompt({
                messageId: target.id,
                initialText: initial,
              });
            } else if (action === 'hide') {
              handleHideMessage(target.id).catch(() => undefined);
            } else if (action === 'unhide') {
              handleShowMessage(target.id).catch(() => undefined);
            } else if (action === 'copy') {
              const text = editableTextFromMessage(target);
              if (text == null) {
                showToast(toastMessage('无法复制', '该消息没有可复制的文本'));
                return;
              }
              Clipboard.setString(text);
              showToast('已复制');
            } else if (action === 'fork') {
              handleForkFromMessage(target.id).catch(() => undefined);
            } else if (action === 'rollback') {
              handleRollbackFromMessage(target.id);
            } else if (action === 'delete') {
              Alert.alert('删除消息', '确定删除这条消息？', [
                {text: '取消', style: 'cancel'},
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () =>
                    handleDeleteMessage(target.id).catch(() => undefined),
                },
              ]);
            }
          }}
        />
        <TextPromptModal
          visible={messageEditPrompt != null}
          title="编辑消息"
          label="内容"
          placeholder="输入消息内容"
          initialValue={messageEditPrompt?.initialText ?? ''}
          confirmLabel="保存"
          onClose={() => setMessageEditPrompt(undefined)}
          onConfirm={async value => {
            const prompt = messageEditPrompt;
            setMessageEditPrompt(undefined);
            if (prompt) {
              await handleSaveMessageEdit(prompt.messageId, value);
            }
          }}
        />
        <ModelPickerModal
          visible={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
          onSelected={() => refreshChatMeta().catch(() => undefined)}
        />
        <AgentPickerModal
          visible={agentPickerOpen}
          onClose={() => setAgentPickerOpen(false)}
          onSelected={() => refreshChatMeta().catch(() => undefined)}
        />
        {sessionRenameModal}
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="chat" />
      {currentProject ? (
        <Pressable
          style={[
            styles.projectBanner,
            {
              backgroundColor: tokens.surfaceElevated,
              borderBottomColor: tokens.borderLight,
            },
          ]}
          onPress={() => setProjectDrawerOpen(true)}>
          <Text style={[styles.bannerLabel, {color: tokens.textSecondary}]}>
            当前项目
          </Text>
          <Text style={[styles.bannerName, {color: tokens.primary}]}>
            {currentProject.name}
          </Text>
        </Pressable>
      ) : null}
      <SegmentedControl
        tokens={tokens}
        value={sessionListPanel}
        onChange={setSessionListPanel}
        options={[
          {value: 'sessions', label: '会话'},
          {value: 'template', label: '项目模板'},
        ]}
      />
      {sessionListPanel === 'template' ? (
        projectVfs && projectWorktree && projectId != null ? (
          <View style={styles.flexFill}>
            <VfsFileManager
              key={`project-template-${vfsRefreshKey}`}
              scope={{kind: 'project', projectId}}
              vfs={projectVfs}
              worktree={projectWorktree}
              rootPath="/"
              pullFromParent={{
                scope: {kind: 'project', projectId},
                onPulled: bumpVfsRefresh,
              }}
              onOpenFile={path => openFileEditor(path, 'project')}
            />
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Text style={{color: tokens.textSecondary}}>请先选择项目</Text>
          </View>
        )
      ) : (
        <>
          <ManageHeader
            title="会话"
            batchMode={sessionBatch.active}
            selectedCount={sessionBatch.selectedCount}
            onEnterBatch={sessionBatch.enter}
            onCancelBatch={sessionBatch.exit}
            onDelete={confirmBatchDelete}
            hint="选择要删除的会话"
            normalActions={
              <PrimaryButton
                label="新建会话"
                tokens={tokens}
                onPress={() => handleCreateSession().catch(() => undefined)}
              />
            }
          />
          <FlatList
            style={styles.sessionList}
            contentContainerStyle={styles.sessionListContent}
            data={sessions}
            keyExtractor={item => item.id}
            ListEmptyComponent={
              <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                暂无会话
              </Text>
            }
            renderItem={({item}) => {
              const isCurrent = item.id === sessionId;
              return (
                <Pressable
                  style={[
                    styles.sessionCard,
                    {
                      backgroundColor: tokens.surfaceElevated,
                      borderColor: tokens.borderLight,
                    },
                    sessionBatch.isSelected(item.id) && {
                      borderColor: tokens.primary,
                      borderWidth: 2,
                    },
                  ]}
                  onPress={() => {
                    if (sessionBatch.active) {
                      sessionBatch.toggle(item.id);
                    } else {
                      openConversation(item.id);
                    }
                  }}
                  onLongPress={() => {
                    sessionBatch.enter();
                    sessionBatch.toggle(item.id);
                  }}>
                  {sessionBatch.active ? (
                    <BatchCheckbox
                      checked={sessionBatch.isSelected(item.id)}
                      onToggle={() => sessionBatch.toggle(item.id)}
                    />
                  ) : null}
                  <View style={styles.sessionInfo}>
                    <Text
                      style={[styles.sessionTitle, {color: tokens.text}]}
                      numberOfLines={1}>
                      {item.title ?? item.id}
                    </Text>
                    <Text
                      style={[
                        styles.sessionMeta,
                        {color: tokens.textSecondary},
                      ]}>
                      {formatRelativeTimeMs(item.updatedAtMs)}
                      {isCurrent ? ' · 活跃中' : ''}
                    </Text>
                  </View>
                  {isCurrent && !sessionBatch.active ? (
                    <View
                      style={[
                        styles.currentBadge,
                        {backgroundColor: tokens.primary},
                      ]}>
                      <Text style={styles.currentBadgeText}>当前</Text>
                    </View>
                  ) : null}
                  {!sessionBatch.active ? (
                    <>
                      <Pressable
                        hitSlop={8}
                        onPress={e => {
                          e.stopPropagation?.();
                          setMenuSessionId(item.id);
                        }}>
                        <Text
                          style={[
                            styles.menuDots,
                            {color: tokens.textSecondary},
                          ]}>
                          ⋮
                        </Text>
                      </Pressable>
                      <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
                        ›
                      </Text>
                    </>
                  ) : null}
                </Pressable>
              );
            }}
          />
          <BottomSheetMenu
            visible={menuSessionId != null}
            items={[
              {label: '重命名', action: 'rename'},
              {label: '复制', action: 'copy'},
              {label: '删除', action: 'delete', danger: true},
            ]}
            onClose={() => setMenuSessionId(undefined)}
            onSelect={action => {
              const sid = menuSessionId;
              setMenuSessionId(undefined);
              if (sid == null) {
                return;
              }
              if (action === 'rename') {
                openSessionRenamePrompt(sid);
              } else if (action === 'copy') {
                handleCopySession(sid).catch(() => undefined);
              } else if (action === 'delete') {
                confirmDeleteSession(sid);
              }
            }}
          />
          {sessionRenameModal}
        </>
      )}
      <ProjectDrawer
        visible={projectDrawerOpen}
        projects={projects}
        currentProjectId={projectId}
        onClose={() => setProjectDrawerOpen(false)}
        onSelect={async id => {
          await setCurrentProject(id);
          await reloadLists();
        }}
        onCreateProject={handleCreateProject}
        onRenameProject={handleRenameProject}
        onDeleteSelected={handleDeleteProjects}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  projectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bannerLabel: {fontSize: 12},
  bannerName: {fontSize: 15, fontWeight: '600'},
  sessionList: {flex: 1},
  sessionListContent: {paddingBottom: 16},
  flexFill: {flex: 1},
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 5,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  sessionInfo: {flex: 1, minWidth: 0},
  sessionTitle: {fontSize: 16, fontWeight: '600', marginBottom: 4},
  sessionMeta: {fontSize: 13},
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 4,
  },
  currentBadgeText: {color: '#FFFFFF', fontSize: 12, fontWeight: '600'},
  menuDots: {fontSize: 18, paddingHorizontal: 4},
  chevron: {fontSize: 22, fontWeight: '300'},
  empty: {textAlign: 'center', marginTop: 32},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  chatPanel: {flex: 1},
  loadMoreBtn: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
