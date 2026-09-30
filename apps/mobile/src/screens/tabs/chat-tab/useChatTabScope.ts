/**
 * Chat tab local UI scope: projects/sessions lists, subviews, drawers, VFS handles.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Alert, DeviceEventEmitter, Linking} from 'react-native';
import {showAppToast} from '@/services/app-toast';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  type ChatProject,
  type ChatSession,
  type SkillToolRef,
} from '@novel-master/core/chat';
import {toastMessage} from '@/errors/toast-message';
import {
  loadChatAgentMeta,
  type ChatAgentMeta,
} from '@/services/chat-agent-meta';
import {
  isChatTokenPreciseWarmInflight,
  loadChatPromptTokenLabelResilient,
} from '@/services/chat-prompt-tokens.service';
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
import {
  resolveChatLinkIntent,
} from './chat-link-nav';
import {chatLinkNotFoundMessage} from '@novel-master/core/chat';

export type SessionListPanel = 'sessions' | 'projects';
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
  const [currentProject, setCurrentProjectMeta] = useState<
    ChatProject | undefined
  >();
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
  // agentMeta 未加载窗口用 undefined 表达（au/B-1）：undefined = 锁定/占位，
  // 绝不用 source:'none' 占位冒充「已删待重选」——none 仅在 loadChatAgentMeta
  // 归一（AgentRunResolveError）成功落位后才出现。
  const [agentMeta, setAgentMeta] = useState<ChatAgentMeta | undefined>(
    undefined,
  );
  const [hasWorkspaceModel, setHasWorkspaceModel] = useState(false);

  // token 标签刷新防抖窗口（message-token-cache Step 4 / T-TC6）：300ms
  // trailing。transcript 变化、回滚、置位/压缩、meta 刷新链尾等多个触发源
  // 会在短时间内连发，这里在 hook 读口把它们合并成一次 service 调用。
  // 与 desktop service 层同款语义：窗口内触发重置计时共享同一次执行；
  // 在途时新触发复用在途并安排追赶轮（最后一次触发必产生一次计算）。
  const CHAT_TOKEN_LABEL_DEBOUNCE_MS = 300;

  // 升级回调的会话身份闸（cr-fix-spec-r2 s2/B-1 场景①）：记录最近一次
  // 刷新所属会话，升级回调写回前比对——跨会话切换后，旧会话在途升级的
  // 精确标签不得写进新会话的 meta（service 层 gen 闸之外的双保险）。
  const tokenLabelSessionRef = useRef<string | null>(null);

  // 切会话立即清 chip（2026-09-30 用户实报「切换会话显示上一个会话的
  // token 才刷新」）：token 标签属于它会话——会话一变就同步归位 '…'
  // （加载态），并让身份闸接管所有权（旧会话迟到的一切写回被丢弃）。
  // 原本下方两处「保留旧值」的注释以为 loadChatAgentMeta 重建 meta 时会
  // 清场，实现里 `...meta` 不含 tokenLabel、显式的 `prev?.tokenLabel` 又
  // 把旧值带进来——残留整整一轮刷新窗口（防抖 300ms + 装配/读数 ~1s）的
  // **错误数字**。同会话内的刷新（压缩/发送后重算）不受影响：sessionId
  // 没变，本 effect 不触发，保留旧值的语义照旧成立。
  // 用 useLayoutEffect 而非 useEffect（r4-app-2）：清场必须发生在**提交后、
  // 绘制前**——useEffect 是 post-paint 的，切会话那一帧仍可能把旧数字绘出来，
  // 「一帧不漏」就只剩注释里的口号。布局阶段同步归位后（布局期写 state 的
  // 补渲染也在绘制前完成），旧数字没有任何一帧可见；跨会话切换一次会话
  // 才走一遍，这次额外渲染的代价可忽略。
  useLayoutEffect(() => {
    tokenLabelSessionRef.current = sessionId ?? null;
    setAgentMeta(prev =>
      prev == null || sessionId == null
        ? prev
        : {...prev, tokenLabel: '…'},
    );
  }, [sessionId]);

  // 防抖槽（复用 refreshChatMetaInflightRef 的在途槽模式，单槽服务当前会话）：
  // - deferred：trailing 计时挂起中，窗口内所有 caller 共享「这一次执行」；
  // - running：在途执行链（到期执行若上一轮仍在途则挂其后串行，绝不并发）；
  // - hasLabel：本会话是否已刷出过非空标签——run 在途冻结的「有东西可看」
  //   判据（声明在 runChatTokenLabelRefresh 之前，供其在执行时读写）。
  const chatTokenLabelDebounceRef = useRef<{
    key: string;
    hasLabel: boolean;
    timer: ReturnType<typeof setTimeout> | null;
    deferred: {
      promise: Promise<void>;
      resolve: (value: Promise<void>) => void;
    } | null;
    running: Promise<void> | null;
  }>({key: '', hasLabel: false, timer: null, deferred: null, running: null});

  const runChatTokenLabelRefresh = useCallback(async () => {
    // meta 未加载（undefined）时保持未加载态：partial 更新不能凭空造出
    // 残缺的 meta 对象（缺字段的假 meta 会被当成已加载渲染）。
    if (projectId == null || sessionId == null) {
      setAgentMeta(prev => (prev == null ? prev : {...prev, tokenLabel: ''}));
      return;
    }
    tokenLabelSessionRef.current = sessionId;
    // run 在途冻结（2026-09-30 拍板「chip 首帧先修」）：run 进行中提示词
    // 不变，而一次首帧刷新 = 整串装配 0.7~1.2s + 读口 resolve 1.2~1.7s，
    // 与流式渲染同拍挤占 JS 线程与单 SQLite 连接（append/settle 各一轮
    // ~2.4s，真机实锤）。判定放在防抖**执行时**而非排程时：run 结束沿
    // （onSettled / 末条转录事件）触发的刷新 300ms 后才执行，彼时 core 的
    // finally 已反注册 abortRegistry，补刷照常落地。只在该会话已显示过
    // 标签时冻结——切进运行中会话的首帧不冻，否则 chip 会空白到 run 结束。
    const debounceSlot = chatTokenLabelDebounceRef.current;
    if (
      debounceSlot.key === `${projectId}#${sessionId}` &&
      debounceSlot.hasLabel &&
      runtime.abortRegistry.has(sessionId)
    ) {
      return;
    }
    // 已有标签时保留旧值而非 '…'：压缩/发送后的重算在大上下文上可达数秒
    // （native 整串计数），旧读数先顶着、新值落地即替换；会话切换路径由
    // loadChatAgentMeta 重建 meta（tokenLabel 归 ''）先清场，不会串显。
    setAgentMeta(prev =>
      prev == null ? prev : {...prev, tokenLabel: prev.tokenLabel || '…'},
    );
    try {
      const tokenLabel = await loadChatPromptTokenLabelResilient(
        runtime,
        {projectId, sessionId},
        // 两阶段升级回调（统计优先口径）：首帧若是估算档（如切模型后无 api
        // 基线），后台跑完家族真分词器精确计数后回填——`glm =` 稍后到位，
        // 首帧 `gpt ≈` 先顶着，不再干等原生整串计数 ~5.8s。写回前过会话
        // 身份闸：本回调发起后若已切到别的会话，旧会话的标签就地丢弃。
        upgraded => {
          if (tokenLabelSessionRef.current !== sessionId) {
            return;
          }
          setAgentMeta(prev =>
            prev == null ? prev : {...prev, tokenLabel: upgraded},
          );
        },
        {
          // 中途弃权（2026-09-30 回滚竞态）：本刷新起跑后 run 才注册时，冻结闸
          // 管不到已经在跑的这一轮——build 分段间检查本判定，run 起步即弃权
          // 返回空串，把 JS 线程与 SQLite 让给发送链（曾把 POST 从 +1.2s 拖到
          // +19.6s）。只在已有标签可保时弃权：切进运行中会话的首帧照算。
          shouldBail: () =>
            chatTokenLabelDebounceRef.current.hasLabel &&
            runtime.abortRegistry.has(sessionId),
        },
      );
      // 空串 = 中途弃权：保留旧标签，不写 meta、不置 hasLabel。
      // 落地前过会话身份闸（2026-09-30 切会话残留第三源）：防抖槽换 key 不
      // 取消在途轮，本刷新闭包里的 sessionId 若已被切走，读数就地丢弃——
      // 与升级回调（上方 upgraded 闸）同一口径。
      if (tokenLabel && tokenLabelSessionRef.current === sessionId) {
        setAgentMeta(prev => (prev == null ? prev : {...prev, tokenLabel}));
        // 冻结判据维护：刷出非空标签后，本会话才有「可冻结的旧值」可保。
        if (
          chatTokenLabelDebounceRef.current.key ===
          `${projectId}#${sessionId}`
        ) {
          chatTokenLabelDebounceRef.current.hasLabel = true;
        }
      }
    } catch {
      // 失败清标签同样过闸：旧会话的失败不得抹掉新会话的显示。
      if (tokenLabelSessionRef.current === sessionId) {
        setAgentMeta(prev => (prev == null ? prev : {...prev, tokenLabel: ''}));
      }
    }
  }, [runtime, projectId, sessionId]);

  const refreshChatTokenLabel = useCallback((): Promise<void> => {
    // 压缩预热窗口（warmChatTokenLabelAfterCompaction）：chip 冻结旧标签，
    // 预热完成后由压缩流程补一次刷新（首帧 L1 命中精确档，无 gpt ≈ 跳变）。
    if (sessionId != null && isChatTokenPreciseWarmInflight(sessionId)) {
      return Promise.resolve();
    }
    const key = `${projectId ?? ''}#${sessionId ?? ''}`;
    const slot = chatTokenLabelDebounceRef.current;
    if (slot.key !== key) {
      // 换会话：旧 key 的计时作废（在途一轮让它自然落定，不再挂新 caller）。
      if (slot.timer != null) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
      slot.key = key;
      // 换会话即换「有东西可看」判据：新会话还没刷出过标签，冻结不生效。
      slot.hasLabel = false;
      slot.deferred = null;
      slot.running = null;
    }
    const scheduleTrailing = () => {
      if (slot.timer != null) {
        clearTimeout(slot.timer);
      }
      const timerKey = key;
      slot.timer = setTimeout(() => {
        slot.timer = null;
        // 计时期间又切了会话（无新触发清理）：本轮按旧 key 作废。
        if (slot.key !== timerKey) {
          return;
        }
        const deferred = slot.deferred;
        slot.deferred = null;
        const previousRun = slot.running;
        const run = (
          previousRun ? previousRun.catch(() => undefined) : Promise.resolve()
        ).then(() => runChatTokenLabelRefresh());
        slot.running = run;
        const settle = () => {
          if (slot.running === run) {
            slot.running = null;
          }
        };
        run.then(settle, settle);
        // runner 内部已全 try/catch、理论上不 reject；这里仍挂兜底，保证
        // caller（多为 void 调用）不接 rejection 也不产生 unhandled。
        run.catch(() => undefined);
        if (deferred != null) {
          deferred.resolve(run);
        }
      }, CHAT_TOKEN_LABEL_DEBOUNCE_MS);
    };
    if (slot.running != null) {
      // 在途复用：并发触发直接挂正在跑的一轮；追赶轮保证新触发最终被计算。
      scheduleTrailing();
      return slot.running;
    }
    if (slot.deferred == null) {
      let resolve!: (value: Promise<void>) => void;
      const promise = new Promise<void>(res => {
        resolve = res;
      });
      slot.deferred = {promise, resolve};
    }
    scheduleTrailing();
    return slot.deferred.promise;
  }, [projectId, sessionId, runChatTokenLabelRefresh]);

  // 卸载清理：别让挂起的防抖计时在组件卸载后再触发 setState。
  useEffect(
    () => () => {
      const slot = chatTokenLabelDebounceRef.current;
      if (slot.timer != null) {
        clearTimeout(slot.timer);
        slot.timer = null;
      }
    },
    [],
  );

  // refreshChatMeta 的在途复用槽：首屏三处触发（本 hook 的 dep effect、
  // Provider 的 conversation effect、useFocusEffect）在同一挂载周期内
  // 重入，同参调用共享在途 promise，只跑一轮查询。
  // round 是落地的会话身份闸（r4-app-1）：每新起一轮自增，落定前与槽内
  // 轮次比对——只有仍是槽内最新一轮的读数才许落地。切会话后旧会话在途的
  // loadChatAgentMeta 落定（含失败）一律丢弃，否则旧会话的 agentName /
  // modelLabel 会写进新会话（tokenLabel 因显式保留恰好幸免，其余字段不是）。
  const refreshChatMetaInflightRef = useRef<{
    key: string;
    round: number;
    promise: Promise<void>;
  } | null>(null);
  const refreshChatMetaRoundRef = useRef(0);

  // showToast 经 ref 取用：它随渲染可能换引用（消费方 context mock 每次
  // 渲染给新函数），若进 refreshChatMeta 依赖会连锁重建 → dep effect 无限
  // 重跑。ref 保住依赖稳定，调用时取最新引用。
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const refreshChatMeta = useCallback(() => {
    const key = `${projectId ?? ''}#${sessionId ?? ''}`;
    const inflight = refreshChatMetaInflightRef.current;
    if (inflight != null && inflight.key === key) {
      return inflight.promise;
    }
    const round = ++refreshChatMetaRoundRef.current;
    // 落地权判据：在途槽里还是这一轮（中途没被别的会话/参数的轮次顶掉）。
    const isCurrentRound = () =>
      refreshChatMetaInflightRef.current?.round === round;
    const promise = (async () => {
      // getCurrentModelId 与 loadChatAgentMeta 互不依赖（后者只需
      // projectId/sessionId），并行发起；两路赋值顺序保持
      // （先 hasWorkspaceModel 后 agentMeta），失败语义不变。
      const metaPromise =
        projectId != null && sessionId != null
          ? loadChatAgentMeta(runtime, projectId, sessionId)
          : undefined;
      // 兜底挂接：getCurrentModelId 先失败提前退出时，在途 meta 查询的
      // 拒绝不会变成 unhandled rejection（其结果本就不会再被消费）。
      metaPromise?.catch(() => undefined);
      const modelId = await runtime.state.getCurrentModelId();
      setHasWorkspaceModel(modelId != null && modelId !== '');
      if (metaPromise == null) {
        // 无项目或无活动会话时无法解析 session 绑定：保持未加载（锁定）态，
        // 不用 source:'none' 占位——那会被消费方当成「已删待重选」。
        // 同样过身份闸：本轮的「无会话」结论不能清掉切换后新会话已落地的 meta。
        if (isCurrentRound()) {
          setAgentMeta(undefined);
        }
        return;
      }
      try {
        const meta = await metaPromise;
        // 会话身份闸（r4-app-1）：旧会话在途的 meta 落定不得写进新会话——
        // 合并写回与链尾标签刷新整段都要「仍是最新一轮」才执行（标签刷新
        // 一旦放行会把身份闸重新指到旧会话，残留就从 meta 字段漏回来）。
        if (!isCurrentRound()) {
          return;
        }
        setAgentMeta(prev => ({
          ...prev,
          ...meta,
          tokenLabel: prev?.tokenLabel ?? '…',
        }));
        void refreshChatTokenLabel();
      } catch (error) {
        // loadChatAgentMeta 仅归一 AgentRunResolveError（→none meta）；走到
        // 这里的是 ChatError 等其它异常——保持未加载（锁定）态并提示错误，
        // 绝不冒充「已删待重选」（au/B-1 / au/C-orch-2）。失败清场同样过闸：
        // 旧会话的失败既不该清掉新会话的 meta，也不该弹与新会话无关的提示。
        if (!isCurrentRound()) {
          return;
        }
        setAgentMeta(undefined);
        showToastRef.current(toastMessage('智能体信息加载失败', error));
      }
    })();
    refreshChatMetaInflightRef.current = {key, round, promise};
    // 落定后清引用：只清自己这一轮，避免覆盖后继（不同参数）的刷新；
    // 完成后无 inflight，下次调用（如重新聚焦）正常发起新一轮。
    const settleInflight = () => {
      if (refreshChatMetaInflightRef.current?.promise === promise) {
        refreshChatMetaInflightRef.current = null;
      }
    };
    promise.then(settleInflight, settleInflight);
    return promise;
  }, [runtime, projectId, sessionId, refreshChatTokenLabel]);

  const reloadLists = useCallback(async () => {
    const plist = await runtime.projects.list();
    setProjects(plist);
    const pid = projectId ?? plist[0]?.id;
    if (pid) {
      // projects.get 与 sessions.listByProject 都只依赖 pid、互不依赖，
      // 并行发起（projects.list 必须先行：pid 取自 plist[0] 兜底）。
      const nextSessionsPromise = runtime.sessions.listByProject(pid);
      // 先挂兜底 handler：get 慢于本查询失败时，等待窗口内不会出现
      // unhandled rejection；真正的失败语义由下方 await 原样承接。
      nextSessionsPromise.catch(() => undefined);
      let projectMeta: ChatProject | undefined;
      try {
        projectMeta = await runtime.projects.get(pid);
      } catch {
        projectMeta = undefined;
      }
      setCurrentProjectMeta(projectMeta);
      setSessions(await nextSessionsPromise);
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
    const sub = DeviceEventEmitter.addListener('session-renamed', () => {
      reloadLists().catch(() => undefined);
    });
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
            onPress: () =>
              handleDeleteSession(targetSessionId).catch(() => undefined),
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
    (path: string, scopeKind: 'project' | 'session') => {
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
        ref.domain === 'project' ? ref.projectId ?? projectId : undefined;
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

  // 聊天 markdown 链接点击（webview 上抛 linkClick）：只做意图执行。
  // 识别与探测在 chat-link-nav 纯函数内完成（session 先、project 后，仅文件命中）；
  // http(s) 外跳系统浏览器，外跳失败静默兜底（与原导航守卫语义一致）；
  // session 打开需 projectId+sessionId 齐全，缺参由 openFileEditor 内部降级 no-op。
  const openChatLink = useCallback(
    (href: string) => {
      void resolveChatLinkIntent(href, {
        sessionVfs,
        projectVfs,
      }).then(intent => {
        if (intent.kind === 'external') {
          void Linking.openURL(intent.url).catch(() => undefined);
          return;
        }
        if (intent.kind === 'file') {
          openFileEditor(intent.path, intent.scope);
          return;
        }
        if (intent.kind === 'not-found') {
          // 路径型链接双域探测未命中：用户拍板弹提示，不再静默无动作
          showAppToast(chatLinkNotFoundMessage(intent.path));
        }
      });
    },
    [sessionVfs, projectVfs, openFileEditor],
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
    openChatLink,
    openSubagentSession,
    openSkillDetail,
    sessionVfs,
    sessionWorktree,
    projectVfs,
    projectWorktree,
  };
}

export type UseChatTabScopeResult = ReturnType<typeof useChatTabScope>;
