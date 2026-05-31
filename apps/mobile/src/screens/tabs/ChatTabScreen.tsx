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
import type {ChatProject, ChatSession} from '@novel-master/core';
import {AppHeader} from '../../components/chrome/AppHeader';
import {ProjectDrawer} from '../../components/chrome/ProjectDrawer';
import {SessionActionsDrawer} from '../../components/chrome/SessionActionsDrawer';
import {VfsFileManager} from '../../components/vfs/VfsFileManager';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useRuntime} from '../../hooks/useRuntime';
import {useMobileScope} from '../../hooks/useMobileScope';
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

  useEffect(() => {
    setChat({
      chatSubview,
      sessionListPanel,
      sessionTitle: currentSession?.title ?? currentSession?.id,
      onBackFromConversation: () => setChatSubview('sessions'),
      onOpenDrawer: () => {
        if (chatSubview === 'conversation') {
          setSessionDrawerOpen(true);
        } else {
          setProjectDrawerOpen(true);
        }
      },
    });
  }, [chatSubview, sessionListPanel, currentSession, setChat]);

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
          <View style={styles.placeholder}>
            <Text style={{color: tokens.textSecondary}}>消息流（M3）</Text>
          </View>
        ) : (
          <VfsFileManager />
        )}
        <SessionActionsDrawer
          visible={sessionDrawerOpen}
          onClose={() => setSessionDrawerOpen(false)}
          onRealPrompt={() => navigation.navigate('RealPrompt')}
          onSessionLog={() => navigation.navigate('SessionLog')}
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
        <View style={styles.placeholder}>
          <Text style={{color: tokens.textSecondary}}>
            项目模板 VFS（M2）
          </Text>
        </View>
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
});
