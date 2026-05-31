/**
 * Chat tab: session list / template sub-tabs, conversation workspace (M1 skeleton).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ChatMessage, ChatProject, ChatSession} from '@novel-master/core';
import {AppHeader} from '../../components/chrome/AppHeader';
import {ChatComposer} from '../../components/chat/ChatComposer';
import {ChatMetaBar} from '../../components/chat/ChatMetaBar';
import {MessageList} from '../../components/chat/MessageList';
import {ProjectDrawer} from '../../components/chrome/ProjectDrawer';
import {SessionActionsDrawer} from '../../components/chrome/SessionActionsDrawer';
import {ModelPickerModal} from '../../components/provider/ModelPickerModal';
import {VfsFileManager} from '../../components/vfs/VfsFileManager';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useRuntime} from '../../hooks/useRuntime';
import {useMobileScope} from '../../hooks/useMobileScope';
import {
  loadChatAgentMeta,
  type ChatAgentMeta,
} from '../../services/chat-agent-meta';
import {APP_UI_KEY_SHOW_FULL_TOOL_PARAMS} from '../../storage/app-ui-keys';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type SessionListPanel = 'sessions' | 'template';
type ChatSubview = 'sessions' | 'conversation';
type ConversationPanel = 'chat' | 'workspace';

export function ChatTabScreen() {
  const {tokens} = useTheme();
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
  const [batchMode, setBatchMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    new Set(),
  );
  const {appUi} = useNovelMaster();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [agentMeta, setAgentMeta] = useState<ChatAgentMeta>({
    agentId: undefined,
    agentName: '—',
    modelLabel: '—',
    hasDedicatedModel: false,
  });
  const [hasWorkspaceModel, setHasWorkspaceModel] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [showFullToolParams, setShowFullToolParams] = useState(false);

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

  const refreshChatMeta = useCallback(async () => {
    const modelId = await runtime.state.getCurrentModelId();
    setHasWorkspaceModel(modelId != null && modelId !== '');
    try {
      setAgentMeta(await loadChatAgentMeta(runtime));
    } catch {
      setAgentMeta({
        agentId: undefined,
        agentName: '—',
        modelLabel: '—',
        hasDedicatedModel: false,
      });
    }
  }, [runtime]);

  const reloadMessages = useCallback(async () => {
    if (sessionId == null) {
      setChatMessages([]);
      return;
    }
    const list = await runtime.messages.listBySession(sessionId);
    setChatMessages(list.filter(m => !m.hidden));
  }, [runtime, sessionId]);

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

  useEffect(() => {
    setChat({
      chatSubview,
      sessionListPanel,
      sessionTitle: currentSession?.title ?? currentSession?.id,
      agentName: chatSubview === 'conversation' ? agentMeta.agentName : undefined,
      modelLabel:
        chatSubview === 'conversation' ? agentMeta.modelLabel : undefined,
      onBackFromConversation: () => setChatSubview('sessions'),
      onOpenDrawer: () => {
        if (chatSubview === 'conversation') {
          setSessionDrawerOpen(true);
        } else {
          setProjectDrawerOpen(true);
        }
      },
    });
  }, [chatSubview, sessionListPanel, currentSession, agentMeta, setChat]);

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

  const handleCreateProject = useCallback(async () => {
    const created = await runtime.projects.create(`项目 ${Date.now()}`);
    await setCurrentProject(created.id);
    await refreshScope();
    await reloadLists();
  }, [runtime, setCurrentProject, refreshScope, reloadLists]);

  const handleCreateSession = useCallback(async () => {
    if (projectId == null) {
      return;
    }
    const created = await runtime.sessions.create(projectId, '新会话');
    await setCurrentSession(created.id);
    await reloadLists();
    await openConversation(created.id);
  }, [runtime, projectId, setCurrentSession, reloadLists, openConversation]);

  const deleteSelectedSessions = useCallback(async () => {
    for (const id of selectedSessionIds) {
      await runtime.sessions.delete(id);
    }
    setSelectedSessionIds(new Set());
    setBatchMode(false);
    if (sessionId && selectedSessionIds.has(sessionId)) {
      setChatSubview('sessions');
    }
    await refreshScope();
    await reloadLists();
  }, [
    runtime,
    selectedSessionIds,
    sessionId,
    refreshScope,
    reloadLists,
  ]);

  const confirmBatchDelete = useCallback(() => {
    const count = selectedSessionIds.size;
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
  }, [selectedSessionIds.size, deleteSelectedSessions]);

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

  if (chatSubview === 'conversation') {
    return (
      <View style={[styles.root, {backgroundColor: tokens.background}]}>
        <AppHeader pageKey="chat" />
        <View style={styles.subTabs}>
          <SubTab
            label="聊天"
            active={conversationPanel === 'chat'}
            onPress={() => setConversationPanel('chat')}
            tokens={tokens}
          />
          <SubTab
            label="会话工作区"
            active={conversationPanel === 'workspace'}
            onPress={() => setConversationPanel('workspace')}
            tokens={tokens}
          />
        </View>
        {conversationPanel === 'chat' ? (
          projectId != null && sessionId != null ? (
            <View style={styles.chatPanel}>
              <ChatMetaBar meta={agentMeta} />
              <MessageList
                messages={chatMessages}
                streamingText={streamingText}
                showFullToolParams={showFullToolParams}
              />
              <ChatComposer
                scope={{projectId, sessionId}}
                hasModel={hasWorkspaceModel || agentMeta.hasDedicatedModel}
                running={agentRunning}
                onRunningChange={setAgentRunning}
                onStreamText={delta =>
                  setStreamingText(prev => prev + delta)
                }
                onStreamReset={() => setStreamingText('')}
                onMessagesChanged={() => {
                  reloadMessages().catch(() => undefined);
                  refreshChatMeta().catch(() => undefined);
                }}
                onNeedModel={() => setModelPickerOpen(true)}
              />
            </View>
          ) : (
            <View style={styles.placeholder}>
              <Text style={{color: tokens.textSecondary}}>请先选择会话</Text>
            </View>
          )
        ) : sessionVfs && sessionWorktree ? (
          <VfsFileManager
            scope={{
              kind: 'session',
              projectId: projectId!,
              sessionId: sessionId!,
            }}
            vfs={sessionVfs}
            worktree={sessionWorktree}
            rootPath="/"
            onOpenFile={path => openFileEditor(path, 'session')}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={{color: tokens.textSecondary}}>请先选择会话</Text>
          </View>
        )}
        <SessionActionsDrawer
          visible={sessionDrawerOpen}
          onClose={() => setSessionDrawerOpen(false)}
          onSwitchModel={() => {
            setSessionDrawerOpen(false);
            setModelPickerOpen(true);
          }}
          onRealPrompt={() => navigation.navigate('RealPrompt')}
          onSessionLog={() => navigation.navigate('SessionLog')}
        />
        <ModelPickerModal
          visible={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
          onSelected={() => refreshChatMeta().catch(() => undefined)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="chat" />
      {currentProject ? (
        <Pressable
          style={[styles.banner, {backgroundColor: tokens.surface}]}
          onPress={() => setProjectDrawerOpen(true)}>
          <Text style={{color: tokens.text}}>{currentProject.name}</Text>
        </Pressable>
      ) : null}
      <View style={styles.subTabs}>
        <SubTab
          label="会话"
          active={sessionListPanel === 'sessions'}
          onPress={() => setSessionListPanel('sessions')}
          tokens={tokens}
        />
        <SubTab
          label="项目模板"
          active={sessionListPanel === 'template'}
          onPress={() => setSessionListPanel('template')}
          tokens={tokens}
        />
      </View>
      {sessionListPanel === 'template' ? (
        projectVfs && projectWorktree ? (
          <VfsFileManager
            scope={{kind: 'project', projectId: projectId!}}
            vfs={projectVfs}
            worktree={projectWorktree}
            rootPath="/template"
            onOpenFile={path => openFileEditor(path, 'project')}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={{color: tokens.textSecondary}}>请先选择项目</Text>
          </View>
        )
      ) : (
        <>
          <View style={styles.toolbar}>
            <Pressable onPress={handleCreateSession}>
              <Text style={{color: tokens.primary}}>新建会话</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setBatchMode(m => !m);
                setSelectedSessionIds(new Set());
              }}>
              <Text style={{color: tokens.text}}>
                {batchMode ? '取消' : '批量'}
              </Text>
            </Pressable>
            {batchMode ? (
              <Pressable onPress={confirmBatchDelete}>
                <Text style={{color: tokens.danger}}>删除</Text>
              </Pressable>
            ) : null}
          </View>
          <FlatList
            data={sessions}
            keyExtractor={item => item.id}
            ListEmptyComponent={
              <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                暂无会话
              </Text>
            }
            renderItem={({item}) => (
              <Pressable
                style={[styles.sessionRow, {borderBottomColor: tokens.border}]}
                onPress={() => {
                  if (batchMode) {
                    setSelectedSessionIds(prev => {
                      const next = new Set(prev);
                      if (next.has(item.id)) {
                        next.delete(item.id);
                      } else {
                        next.add(item.id);
                      }
                      return next;
                    });
                  } else {
                    openConversation(item.id);
                  }
                }}
                onLongPress={() => {
                  setBatchMode(true);
                  setSelectedSessionIds(new Set([item.id]));
                }}>
                <Text style={{color: tokens.text}}>
                  {item.title ?? item.id}
                  {item.id === sessionId ? ' · 当前' : ''}
                  {batchMode && selectedSessionIds.has(item.id) ? ' ✓' : ''}
                </Text>
              </Pressable>
            )}
          />
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
        onCreate={handleCreateProject}
        onDeleteSelected={handleDeleteProjects}
      />
    </View>
  );
}

function SubTab({
  label,
  active,
  onPress,
  tokens,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  tokens: {primary: string; text: string; border: string};
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.subTab,
        active && {borderBottomColor: tokens.primary, borderBottomWidth: 2},
      ]}>
      <Text style={{color: active ? tokens.primary : tokens.text}}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  banner: {padding: 12, marginHorizontal: 12, marginTop: 8, borderRadius: 8},
  subTabs: {flexDirection: 'row', marginTop: 8},
  subTab: {flex: 1, alignItems: 'center', paddingVertical: 10},
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    gap: 12,
  },
  sessionRow: {padding: 16, borderBottomWidth: StyleSheet.hairlineWidth},
  empty: {textAlign: 'center', marginTop: 32},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  chatPanel: {flex: 1},
});
