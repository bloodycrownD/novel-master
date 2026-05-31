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
import {TemplatePullButton} from '../../components/template/TemplatePullButton';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {VfsFileManager} from '../../components/vfs/VfsFileManager';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {ListBatchBar} from '../../components/batch/ListBatchBar';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {
  PrimaryButton,
  SecondaryButton,
} from '../../components/ui/PrototypeButtons';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {formatRelativeTimeMs} from '../../utils/format-relative-time';
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
  const sessionBatch = useBatchSelection();
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
  const [vfsRefreshKey, setVfsRefreshKey] = useState(0);
  const [menuSessionId, setMenuSessionId] = useState<string | undefined>();

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

  const handleCreateProject = useCallback(
    async (name: string) => {
      try {
        const created = await runtime.projects.create(name);
        await setCurrentProject(created.id);
        await refreshScope();
        await reloadLists();
      } catch (error) {
        Alert.alert(
          '创建失败',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [runtime, setCurrentProject, refreshScope, reloadLists],
  );

  const handleRenameProject = useCallback(
    async (projectId: string, name: string) => {
      try {
        await runtime.projects.rename(projectId, name);
        await reloadLists();
      } catch (error) {
        Alert.alert(
          '重命名失败',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [runtime, reloadLists],
  );

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
        Alert.alert('已复制会话', copy.title ?? copy.id);
      } catch (error) {
        Alert.alert(
          '复制失败',
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [runtime, reloadLists],
  );

  const bumpVfsRefresh = useCallback(() => {
    setVfsRefreshKey(key => key + 1);
  }, []);

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
        ) : sessionVfs && sessionWorktree && sessionId != null ? (
          <View style={styles.flexFill}>
            <View style={[styles.pullToolbar, {borderBottomColor: tokens.border}]}>
              <TemplatePullButton
                scope={{kind: 'session', sessionId}}
                onPulled={bumpVfsRefresh}
              />
            </View>
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
            <View style={[styles.pullToolbar, {borderBottomColor: tokens.border}]}>
              <TemplatePullButton
                scope={{kind: 'project', projectId}}
                onPulled={bumpVfsRefresh}
              />
            </View>
            <VfsFileManager
              key={`project-template-${vfsRefreshKey}`}
              scope={{kind: 'project', projectId}}
              vfs={projectVfs}
              worktree={projectWorktree}
              rootPath="/template"
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
          {!sessionBatch.active ? (
            <View
              style={[
                styles.sectionHeader,
                {backgroundColor: tokens.surface},
              ]}>
              <Text style={[styles.sectionTitle, {color: tokens.text}]}>
                会话
              </Text>
              <View style={styles.sectionActions}>
                <SecondaryButton
                  label="管理"
                  tokens={tokens}
                  onPress={sessionBatch.enter}
                />
                <PrimaryButton
                  label="新建会话"
                  tokens={tokens}
                  onPress={() => handleCreateSession().catch(() => undefined)}
                />
              </View>
            </View>
          ) : null}
          <FlatList
            style={sessionBatch.active ? styles.listWithBar : styles.sessionList}
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
            items={[{label: '复制会话', action: 'copy'}]}
            onClose={() => setMenuSessionId(undefined)}
            onSelect={action => {
              const sid = menuSessionId;
              setMenuSessionId(undefined);
              if (action === 'copy' && sid) {
                handleCopySession(sid).catch(() => undefined);
              }
            }}
          />
          {sessionBatch.active ? (
            <ListBatchBar
              selectedCount={sessionBatch.selectedCount}
              onCancel={sessionBatch.exit}
              onDelete={confirmBatchDelete}
            />
          ) : null}
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  sectionTitle: {fontSize: 18, fontWeight: '600'},
  sectionActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
  sessionList: {flex: 1},
  sessionListContent: {paddingHorizontal: 16, paddingBottom: 16},
  pullToolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flexFill: {flex: 1},
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
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
  listWithBar: {marginBottom: 56},
  empty: {textAlign: 'center', marginTop: 32},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  chatPanel: {flex: 1},
});
