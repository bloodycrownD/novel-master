/**
 * Chat tab local UI scope: projects/sessions lists, subviews, drawers, VFS handles.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {Alert, DeviceEventEmitter} from 'react-native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import { type ChatProject, type ChatSession, type SkillToolRef } from "@novel-master/core/chat";
import {toastMessage} from '@/errors/toast-message';
import {
  loadChatAgentMeta,
  type ChatAgentMeta,
} from '@/services/chat-agent-meta';
import {loadChatPromptTokenLabelResilient} from '@/services/chat-prompt-tokens.service';
import type {RootStackParamList} from '@/navigation/types';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {
  clearSessionViewCache,
  clearSessionViewCachesByProject,
  sessionViewCacheKey,
} from '@/services/chat-session-view-cache';
import {clearScrollSnapshotsByProject} from '@/services/chat-list-scroll-cache';
import {clearTranscriptScrollSnapshotsByProject} from '@/services/chat-transcript-scroll-cache';
import {nextDefaultSessionTitle} from '@/utils/session-default-title';

export type SessionListPanel = 'sessions' | 'template';
export type ChatSubview = 'sessions' | 'conversation';
export type ConversationPanel = 'chat' | 'workspace';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type UseChatTabScopeParams = {
  runtime: MobileNovelMasterRuntime;
  projectId: string | undefined;
  sessionId: string | undefined;
  setCurrentProject: (projectId: string) => Promise<void>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  refreshScope: () => Promise<void>;
  showToast: (message: string) => void;
  navigation: Nav;
};

export function useChatTabScope({
  runtime,
  projectId,
  sessionId,
  setCurrentProject,
  setCurrentSession,
  refreshScope,
  showToast,
  navigation,
}: UseChatTabScopeParams) {
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
  const [vfsRefreshKey, setVfsRefreshKey] = useState(0);
  const [menuSessionId, setMenuSessionId] = useState<string | undefined>();
  const [sessionRenamePrompt, setSessionRenamePrompt] = useState<
    {sessionId: string; initialTitle: string} | undefined
  >();
  const [agentMeta, setAgentMeta] = useState<ChatAgentMeta>({
    source: 'none',
    agentId: undefined,
    agentName: '—',
    modelLabel: '—',
    tokenLabel: '',
    hasDedicatedModel: false,
    modelSource: 'session',
  });
  const [hasWorkspaceModel, setHasWorkspaceModel] = useState(false);

  const refreshChatTokenLabel = useCallback(async () => {
    if (projectId == null || sessionId == null) {
      setAgentMeta(prev => ({...prev, tokenLabel: ''}));
      return;
    }
    setAgentMeta(prev => ({...prev, tokenLabel: '…'}));
    try {
      const tokenLabel = await loadChatPromptTokenLabelResilient(runtime, {
        projectId,
        sessionId,
      });
      setAgentMeta(prev => ({...prev, tokenLabel}));
    } catch {
      setAgentMeta(prev => ({...prev, tokenLabel: ''}));
    }
  }, [runtime, projectId, sessionId]);

  const refreshChatMeta = useCallback(async () => {
    const modelId = await runtime.state.getCurrentModelId();
    setHasWorkspaceModel(modelId != null && modelId !== '');
    if (projectId == null) {
      setAgentMeta({
        source: 'none',
        agentId: undefined,
        agentName: '—',
        modelLabel: '—',
        tokenLabel: '',
        hasDedicatedModel: false,
        modelSource: 'session',
      });
      return;
    }
    if (sessionId == null) {
      // 无活动会话时无法解析 session 绑定，回退到无 meta 状态。
      setAgentMeta({
        source: 'none',
        agentId: undefined,
        agentName: '—',
        modelLabel: '—',
        tokenLabel: '',
        hasDedicatedModel: false,
        modelSource: 'session',
      });
      return;
    }
    try {
      const meta = await loadChatAgentMeta(runtime, projectId, sessionId);
      setAgentMeta(prev => ({
        ...prev,
        ...meta,
        tokenLabel: prev?.tokenLabel ?? '…',
      }));
      void refreshChatTokenLabel();
    } catch {
      setAgentMeta({
        source: 'none',
        agentId: undefined,
        agentName: '—',
        modelLabel: '—',
        tokenLabel: '',
        hasDedicatedModel: false,
        modelSource: 'session',
      });
    }
  }, [runtime, projectId, sessionId, refreshChatTokenLabel]);

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
      const nextSessions = await runtime.sessions.listByProject(pid);
      setSessions(nextSessions);
    } else {
      setCurrentProjectMeta(undefined);
      setSessions([]);
    }
  }, [runtime, projectId]);

  useEffect(() => {
    reloadLists().catch(() => undefined);
  }, [reloadLists]);

  // 详情页改名成功后会广播 session-renamed；无条件 reloadLists（幂等，
  // 跨项目改名时当前项目列表本就无需变化），聊天页标题/列表随 sessions 刷新。
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'session-renamed',
      () => {
        reloadLists().catch(() => undefined);
      },
    );
    return () => sub.remove();
  }, [reloadLists]);

  useEffect(() => {
    refreshChatMeta().catch(() => undefined);
  }, [refreshChatMeta]);

  const currentSession = sessions.find(s => s.id === sessionId);

  const backFromConversation = useCallback(
    () => setChatSubview('sessions'),
    [],
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
    async (targetProjectId: string, name: string) => {
      try {
        await runtime.projects.rename(targetProjectId, name);
        await reloadLists();
      } catch (error) {
        showToast(toastMessage('重命名失败', error));
      }
    },
    [runtime, reloadLists, showToast],
  );

  const handleCreateSession = useCallback(async () => {
    if (projectId == null) {
      showToast('请先创建或选择项目');
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
        if (projectId != null) {
          clearSessionViewCache(
            sessionViewCacheKey(projectId, targetSessionId),
          );
        }
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
    [runtime, projectId, sessionId, refreshScope, reloadLists, showToast],
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

  const deleteSelectedSessions = useCallback(
    async (selectedIds: ReadonlySet<string>, exitSessionBatch: () => void) => {
      const ids = [...selectedIds];
      // 部分成功语义：逐个删除，先删成功的保持已删、不回滚；中途失败即停止并提示剩余未删。
      try {
        for (const id of ids) {
          await runtime.sessions.delete(id);
          if (projectId != null) {
            clearSessionViewCache(sessionViewCacheKey(projectId, id));
          }
        }
      } catch (error) {
        showToast(toastMessage('删除失败', error));
      } finally {
        // 无论删除是否中途失败，都退出批选态，让用户可以重试剩余未删项。
        const deletedCurrent = sessionId != null && ids.includes(sessionId);
        exitSessionBatch();
        if (deletedCurrent) {
          setChatSubview('sessions');
        }
        await refreshScope();
        await reloadLists();
      }
    },
    [runtime, sessionId, projectId, refreshScope, reloadLists, showToast],
  );

  const handleDeleteProjects = useCallback(
    async (ids: string[]) => {
      // 部分成功语义：逐个删除，先删成功的保持已删、不回滚；中途失败即停止并提示剩余未删。
      try {
        for (const id of ids) {
          await runtime.projects.delete(id);
          // 项目删除后按前缀清掉其会话级缓存，避免消息 tail / 滚动快照残留。
          clearSessionViewCachesByProject(id);
          clearScrollSnapshotsByProject(id);
          clearTranscriptScrollSnapshotsByProject(id);
        }
      } catch (error) {
        showToast(toastMessage('删除失败', error));
      } finally {
        await refreshScope();
        await reloadLists();
      }
    },
    [runtime, refreshScope, reloadLists, showToast],
  );

  const bumpWorktreeUiToken = useCallback(() => {
    setVfsRefreshKey(key => key + 1);
  }, []);

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

  const openSessionFilePreview = useCallback(
    (path: string) => {
      setConversationPanel('workspace');
      openFileEditor(path, 'session');
    },
    [openFileEditor],
  );

  // 点击 task 工具卡片跳转到子会话只读浏览页。子会话与当前主会话同属一个项目，
  // 故 projectId 取当前会话的项目，sessionId 用入参（子会话 id）。
  // 文件只有一个共享工作区（父会话 session VFS），子 agent 在父工作区干活，
  // 所以把父会话 sessionId 一并传下去，供文件卡片点击时以父 session scope 打开。
  const openSubagentSession = useCallback(
    (childSessionId: string) => {
      if (projectId == null || sessionId == null) {
        return;
      }
      navigation.navigate('SubagentSessionView', {
        projectId,
        sessionId: childSessionId,
        parentSessionId: sessionId,
      });
    },
    [navigation, projectId, sessionId],
  );

  // skill 卡片跳技能详情。write/edit 缺省域解析出的 project 三元组不带
  // projectId（webview / 卡片无会话上下文），这里按当前会话项目补齐。
  const openSkillDetail = useCallback(
    (ref: SkillToolRef) => {
      const targetProjectId =
        ref.domain === 'project' ? (ref.projectId ?? projectId) : undefined;
      if (ref.domain === 'project' && targetProjectId == null) {
        return;
      }
      navigation.navigate('SkillDetail', {
        domain: ref.domain,
        name: ref.name,
        ...(targetProjectId != null ? {projectId: targetProjectId} : {}),
      });
    },
    [navigation, projectId],
  );

  const sessionVfs = useMemo(
    () =>
      projectId != null && sessionId != null
        ? runtime.sessionVfs(projectId, sessionId)
        : null,
    [runtime, projectId, sessionId],
  );
  const sessionWorktree = useMemo(
    () =>
      projectId != null && sessionId != null
        ? runtime.workplace({
            kind: 'session',
            projectId,
            sessionId,
          })
        : null,
    [runtime, projectId, sessionId],
  );
  const projectVfs = useMemo(
    () => (projectId != null ? runtime.projectVfs(projectId) : null),
    [runtime, projectId],
  );
  const projectWorktree = useMemo(
    () =>
      projectId != null
        ? runtime.workplace({kind: 'project', projectId})
        : null,
    [runtime, projectId],
  );

  return {
    agentMeta,
    hasWorkspaceModel,
    refreshChatMeta,
    refreshChatTokenLabel,
    projects,
    sessions,
    currentProject,
    currentSession,
    sessionListPanel,
    setSessionListPanel,
    chatSubview,
    setChatSubview,
    conversationPanel,
    setConversationPanel,
    projectDrawerOpen,
    setProjectDrawerOpen,
    sessionDrawerOpen,
    setSessionDrawerOpen,
    vfsRefreshKey,
    bumpWorktreeUiToken,
    menuSessionId,
    setMenuSessionId,
    sessionRenamePrompt,
    setSessionRenamePrompt,
    reloadLists,
    backFromConversation,
    handleCreateProject,
    handleRenameProject,
    handleCreateSession,
    handleRenameSession,
    openSessionRenamePrompt,
    handleCopySession,
    handleDeleteSession,
    confirmDeleteSession,
    deleteSelectedSessions,
    handleDeleteProjects,
    openFileEditor,
    openSessionFilePreview,
    openSubagentSession,
    openSkillDetail,
    sessionVfs,
    sessionWorktree,
    projectVfs,
    projectWorktree,
  };
}

export type UseChatTabScopeResult = ReturnType<typeof useChatTabScope>;
