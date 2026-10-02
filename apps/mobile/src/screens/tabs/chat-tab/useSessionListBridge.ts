/**
 * 会话列表 ↔ 统一宿主的桥接线（chat-webview-unify 第二阶段 wave-2）。
 *
 * 会话列表的**渲染**整体搬进了 `chat-conversation` 文档（web 侧
 * `webview/session-list.ts`），本 hook 只做两件事，边界照 dock 域的「薄渲染」纪律：
 *
 * 1. **下行**：把 RN 侧的数据（会话表 + manager 判活 + 当前会话 + 批量勾选）
 *    算成一条 `sessionList` 载荷。三徽标的布尔判据**全部在这里算完**，
 *    web 侧一律不推导（挂在 `current` 上的「活跃中」曾把 run 收尾后的会话显示成
 *    「还在跑」，2026-09-30 真机实录 GWT-7）。
 * 2. **上行**：`listAction` 十一项的宿主处置（open 走 openConversation 状态机、
 *    delete 弹原生 Alert 确认、rename 走既有 prompt、stopRun 走 manager 单元
 *    abort、longPress 进批量 …；wave-3 起批量头的 `batchDelete` / `batchExit`
 *    也在这里接：前者走 controller 注入的原生确认链，后者清批量态）。
 *    菜单本身仍是 RN 的 `BottomSheetMenu`（消费方在 `ChatConversationPanel`），
 *    本 hook 只出「哪一行的菜单 + 动作怎么执行」。
 *
 * ## 为什么单独成 hook 而不是并进面板
 * 面板本体只管布局与各类 RN Modal 开关；列表的**数据面**（manager 订阅）与
 * **动作面**（九项分发）是一组可独立断言的机制，塞进面板会让那个已经很长的
 * 组件再胖一截，而且测试只能整面板挂载才能碰它们。独立 hook 的另一个好处：
 * 面板在对话视图里也常驻（不再条件渲染），数据面与视图可见性天然解耦。
 *
 * ## 批量选择态为什么不自己建 `useBatchSelection`
 * 真源是 `ChatTabScreen` 顶层那一个（`ChatTabNavigationProvider` 的
 * `sessionBatchActive` / Android 返回键的 `exitSessionBatch` 都吃它的值）——
 * 这里再建一个就成了第二真源，返回键与列表会各说各话。故由调用方注入。
 *
 * 批量删除的确认链同样由调用方注入（见 `confirmBatchDelete` 字段注释）。
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import type {ConversationListAction} from '@/components/chat/ChatConversationBridge';
import type {SessionListItem} from '@/components/chat/ChatConversationBridge';
import type {
  ConversationSessionListPayload,
  ConversationViewStatePayload,
} from '@/components/chat/ChatConversationBridge';
import {useChatTabContext} from './ChatTabProvider';
import type {ChatSubview} from './useChatTabScope';

/** 批量选择态（`useBatchSelection` 的返回值，由调用方注入真源）。 */
export type SessionBatchSelection = {
  readonly active: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly enter: () => void;
  readonly exit: () => void;
  readonly toggle: (id: string) => void;
};

/** web → 宿主的列表动作（形状与 `parseConversationListAction` 的产物一致）。 */
export type SessionListAction = {
  readonly kind: ConversationListAction;
  readonly sessionId?: string;
};

export type UseSessionListBridgeParams = {
  /** 当前视图（`chatSubview`）；决定 `viewState` 与「列表快照是否下发」。 */
  readonly chatSubview: ChatSubview;
  readonly batch: SessionBatchSelection;
  /** 进对话（`open` 动作）：调用方的状态机（setCurrentSession + 水合 + 切视图）。 */
  readonly onOpenConversation: (sessionId: string) => void;
  /**
   * 批量删除的原生确认链（web 上行 `batchDelete` 时调）。
   *
   * **由调用方注入而不是本 hook 自取**：确认链在 `useChatTabController`
   * （`confirmBatchDeleteSessions`），而 controller 挂在 `ChatConversationWebSurface`
   * 那棵子树上——让本 hook 直接调 controller 就等于把它拽进更上层，子树边界就废了。
   * 同 `onOpenConversation` 的注入惯例。
   */
  readonly confirmBatchDelete: (count: number, onConfirm: () => void) => void;
};

export type UseSessionListBridgeResult = {
  /** `viewState` 载荷（`chatSubview` 的投影，web 据此切 data-view）。 */
  readonly viewState: ConversationViewStatePayload;
  /**
   * `sessionList` 载荷；**对话视图下恒为 `null`**，即「本拍不推」。
   *
   * 这是「仅列表态推数据」的实现点：null 让宿主的下发 effect 直接早退，
   * 对话期间列表怎么变都不跨桥；切回列表时恢复成真对象 → 补推一次最新快照。
   */
  readonly sessionListPayload: ConversationSessionListPayload | null;
  /** 列表域上行处置（`onListAction` 直接转交）。 */
  readonly onListAction: (action: SessionListAction) => void;
  /**
   * 活跃 run 会话集合（starting|running 单元）——消费方（会话行的 ⋮ 菜单）据此
   * 决定要不要给这一行加「停止生成」项。与载荷里的 `active` 同源同判据。
   */
  readonly activeRunIds: ReadonlySet<string>;
  /** ⋮ 菜单当前作用的会话（undefined = 未打开）。 */
  readonly menuSessionId: string | undefined;
  /** 打开/关闭 ⋮ 菜单（web 只上报「点了 ⋮」，菜单本体在 RN）。 */
  readonly setMenuSessionId: (sessionId: string | undefined) => void;
};

/** `chatSubview` → `viewState.view`（唯一的映射处，别处别再手写三元）。 */
export function resolveConversationView(
  chatSubview: ChatSubview,
): ConversationViewStatePayload['view'] {
  return chatSubview === 'conversation' ? 'conversation' : 'list';
}

/**
 * 会话行 → `SessionListItem`（三徽标判据全在这里算完）。
 *
 * `interrupted` 带 `!active` 守卫：现网 RN 版就是 `!isRunning && interrupted.has(id)`
 * ——一个会话不会既在跑又「已中断」，同时挂两枚徽标只会让用户以为出了两件事。
 * 刻意**不**把「活跃中」挂在 `current` 上（GWT-7，见文件头）。
 */
export function toSessionListItem(
  session: {id: string; title?: string | null; updatedAtMs: number},
  options: {
    readonly currentSessionId: string | undefined;
    readonly activeRunIds: ReadonlySet<string>;
    readonly interruptedRunIds: ReadonlySet<string>;
  },
): SessionListItem {
  const active = options.activeRunIds.has(session.id);
  return {
    id: session.id,
    ...(session.title != null && session.title !== ''
      ? {title: session.title}
      : {}),
    updatedAtMs: session.updatedAtMs,
    active,
    interrupted: !active && options.interruptedRunIds.has(session.id),
    current: session.id === options.currentSessionId,
  };
}

/**
 * 两个字符串集合的**内容级**判等（size 相同 && 双向 `has` 全中）。
 *
 * 为什么需要它：两个徽标集合合挂在同一个 `subscribe` 通知上（受理 / 收尾 /
 * 替换 / 水合都会触发），而 manager 一次通知里**两个集合常常都没变**。原先
 * `sync()` 无条件 `setState(new Set(...))`——引用必变，于是链条一路放行：
 * `sessionListPayload` 的 `useMemo` 依赖变了 → 重算出新对象 → 宿主的下发
 * 比较器是引用比较、判定「变了」→ 列表态**全量重推**一次。内容一模一样，
 * web 侧却要整批重建 DOM，白烧一次序列化 + 一次渲染。
 *
 * 判等后内容未变就**不换引用**：依赖不变 → memo 不重算 → 载荷引用不变 →
 * 宿主不下发。模块级纯函数导出，这条判路单测直接调它即可，不必挂整棵树。
 */
export function sameStringSet(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  // size 已相等，单向 `has` 全中即等价（集合无重复项，漏判不存在）。
  for (const id of a) {
    if (!b.has(id)) {
      return false;
    }
  }
  return true;
}

export function useSessionListBridge({
  chatSubview,
  batch,
  onOpenConversation,
  confirmBatchDelete,
}: UseSessionListBridgeParams): UseSessionListBridgeResult {
  const ctx = useChatTabContext();
  const {
    sessions,
    menuSessionId,
    setMenuSessionId,
    openSessionRenamePrompt,
    handleCopySession,
    confirmDeleteSession,
    handleCreateSession,
    deleteSelectedSessions,
  } = ctx.scope;
  // 当前会话在 ctx 上（不在 scope 里——scope 是「本 tab 的 UI 局部态」，
  // 当前会话身份属全局 scope）。列表行的「当前」徽标就靠它。
  const sessionId = ctx.sessionId;
  const manager = ctx.runtime.sessionStreamUnitManager;

  // ===== 徽标数据源：manager 判活 / 中断（照 ChatSessionListPanel 迁入的订阅形态） =====
  //
  // 两个集合同沿一个 `subscribe` 通知（受理/收尾/替换/水合都触发），
  // 合并成一次订阅即可——拆成两个 effect 只会多挂一个 listener。
  const [activeRunIds, setActiveRunIds] = useState<ReadonlySet<string>>(
    () => new Set(manager.activeSessionIds()),
  );
  const [interruptedRunIds, setInterruptedRunIds] = useState<
    ReadonlySet<string>
  >(() => new Set(manager.interruptedSessionIds()));
  useEffect(() => {
    const sync = () => {
      // 先取快照、再判等：updater 必须是纯函数（StrictMode 会重放），
      // 所以 manager 的取数放在闭包外，闭包里只做「同内容交回同一引用」。
      const nextActive = new Set(manager.activeSessionIds());
      const nextInterrupted = new Set(manager.interruptedSessionIds());
      // 同内容 → 交回 `prev`（同引用不重渲，payload memo 依赖不变 → 不下发）。
      // 内容真变了 → 换新引用，徽标照常刷新。
      setActiveRunIds(prev =>
        sameStringSet(prev, nextActive) ? prev : nextActive,
      );
      setInterruptedRunIds(prev =>
        sameStringSet(prev, nextInterrupted) ? prev : nextInterrupted,
      );
    };
    sync();
    return manager.subscribe(sync);
  }, [manager]);

  const viewState = useMemo(
    (): ConversationViewStatePayload => ({
      view: resolveConversationView(chatSubview),
    }),
    [chatSubview],
  );

  const sessionListPayload = useMemo((): ConversationSessionListPayload | null => {
    // 对话视图：不下发（null = 宿主 effect 早退）。见返回值的字段注释。
    if (chatSubview !== 'sessions') {
      return null;
    }
    return {
      sessions: sessions.map(session =>
        toSessionListItem(session, {
          currentSessionId: sessionId,
          activeRunIds,
          interruptedRunIds,
        }),
      ),
      // 缺省 = 不在批量态；给了（哪怕空数组）= 在批量态、暂未勾选任何一行。
      // 这个区分不能丢：批量态下点行要走「勾选」而不是「打开会话」。
      ...(batch.active ? {batchSelect: [...batch.selectedIds]} : {}),
    };
  }, [
    chatSubview,
    sessions,
    sessionId,
    activeRunIds,
    interruptedRunIds,
    batch.active,
    batch.selectedIds,
  ]);

  const onListAction = useCallback(
    (action: SessionListAction) => {
      const targetId = action.sessionId;
      // ① 三项「不作用于某一行」的动作先行：`create` 新建一个会话，
      //    `batchDelete` / `batchExit` 作用于**整个勾选集合**（没有「哪一行」可言）。
      //    它们都缺 sessionId，若落到下面的空 id 早退里就是静默空转。
      if (action.kind === 'create') {
        handleCreateSession().catch(() => undefined);
        return;
      }
      if (action.kind === 'batchDelete') {
        // 确认链原样保留：web 只报「点了删除」，Alert 二次确认与逐个删除的
        // 部分成功语义（中途失败即停、剩余可重试）全在宿主这一侧，
        // `deleteSelectedSessions` 的 finally 会自己退出批量态并切回列表。
        confirmBatchDelete(batch.selectedIds.size, () => {
          deleteSelectedSessions(batch.selectedIds, batch.exit).catch(
            () => undefined,
          );
        });
        return;
      }
      if (action.kind === 'batchExit') {
        batch.exit();
        return;
      }
      // ② 其余八项缺 id 一律静默丢弃——拿 `undefined` 去开菜单/改名会命中
      //    「第一条记录」之类的错行。
      if (targetId == null || targetId === '') {
        return;
      }
      switch (action.kind) {
        case 'open':
          onOpenConversation(targetId);
          return;
        case 'menuOpen':
          setMenuSessionId(targetId);
          return;
        case 'rename':
          openSessionRenamePrompt(targetId);
          return;
        case 'copy':
          handleCopySession(targetId).catch(() => undefined);
          return;
        case 'delete':
          // 原生 Alert 二次确认（照搬现网 confirmDeleteSession，不改成无确认直删）
          confirmDeleteSession(targetId);
          return;
        case 'stopRun':
          // 走单元的 abort 语义（retain/freeze 时序由 core 负责）；后续 FINISHED
          // 照常经事件路径收尾，投影回落、集合更新、菜单项消失。
          manager.stopRun(targetId);
          return;
        case 'longPress':
          // 进批量并勾上这一行（现网 Pressable.onLongPress 的两行同款）
          batch.enter();
          batch.toggle(targetId);
          return;
        case 'batchToggle':
          batch.toggle(targetId);
          return;
        default:
          return;
      }
    },
    [
      handleCreateSession,
      onOpenConversation,
      setMenuSessionId,
      openSessionRenamePrompt,
      handleCopySession,
      confirmDeleteSession,
      confirmBatchDelete,
      deleteSelectedSessions,
      manager,
      batch,
    ],
  );

  return {
    viewState,
    sessionListPayload,
    onListAction,
    activeRunIds,
    menuSessionId,
    setMenuSessionId,
  };
}
