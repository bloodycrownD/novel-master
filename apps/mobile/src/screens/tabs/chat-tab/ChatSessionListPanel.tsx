/**
 * Chat tab 会话子视图：**会话列表 + 项目工作区**两分支（单组件）。
 *
 * 本组件承载 `SessionListPanel` 的整个切换面板：顶部分支切换条（SegmentedControl）
 * + 两个互斥分支的内容——`sessions` 分支是 RN 会话列表 FlatList（ManageHeader /
 * 新建 / 批量条 / 会话行 / 三徽标 / ⋮ 菜单全在本文件），`projects` 分支是项目
 * 工作区的 `VfsFileManager`。
 *
 * ## 与 SPA 化的关系（chat-webview-unify 回滚子集）
 *
 * 那一轮曾把本文件壳化：切换条留在 RN，会话列表本体搬进 `chat-conversation` 文档
 * （web 侧 `webview/session-list.ts`），并拆出第二个导出 `ChatSessionListProjectsPanel`
 * 盖在常驻 WebView 之上。本轮回滚后形态即下面这个单组件：面板随 `chatSubview`
 * 条件渲染、会话列表回归 RN 原生 FlatList、`⋮` 菜单（本轮随之从
 * `ChatConversationPanel` 迁回）、项目工作区分支重新走普通 flex 分支而非覆盖层。
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {type ChatSession} from '@novel-master/core/chat';

import {type VfsScope, type VfsService} from '@novel-master/core/vfs';

import {type WorkplaceService} from '@novel-master/core/workplace';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {ManageHeader} from '@/components/batch/ManageHeader';
import {BatchCheckbox} from '@/components/batch/BatchCheckbox';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {PrimaryButton} from '@/components/ui/Buttons';
import {
  VfsFileManager,
  type VfsFileManagerHandle,
} from '@/components/vfs/VfsFileManager';
import {useRuntime} from '@/hooks/useRuntime';
import type {ThemeTokens} from '@/theme/tokens';
import {formatRelativeTimeMs} from '@/utils/format-relative-time';
import type {SessionListPanel} from './useChatTabScope';
import {useChatTabWorkspaceBackState} from './ChatTabNavigationProvider';

export type ChatSessionListPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
  sessionListPanel: SessionListPanel;
  onSessionListPanelChange: (panel: SessionListPanel) => void;
  projectId: string | undefined;
  sessionId: string | undefined;
  sessions: ChatSession[];
  vfsRefreshKey: number;
  projectVfs: VfsService | null;
  projectWorktree: WorkplaceService | null;
  sessionBatchActive: boolean;
  sessionBatchSelectedCount: number;
  onEnterSessionBatch: () => void;
  onExitSessionBatch: () => void;
  onConfirmBatchDelete: () => void;
  onCreateSession: () => void;
  onOpenConversation: (sessionId: string) => void;
  onToggleSessionSelect: (sessionId: string) => void;
  isSessionSelected: (sessionId: string) => boolean;
  menuSessionId: string | undefined;
  onMenuSessionIdChange: (sessionId: string | undefined) => void;
  onOpenSessionRename: (sessionId: string) => void;
  onCopySession: (sessionId: string) => void;
  onConfirmDeleteSession: (sessionId: string) => void;
  onOpenFileEditor: (path: string, scopeKind: 'project' | 'session') => void;
};

function ChatSessionListPanelInner({
  tokens,
  visible,
  sessionListPanel,
  onSessionListPanelChange,
  projectId,
  sessionId,
  sessions,
  vfsRefreshKey,
  projectVfs,
  projectWorktree,
  sessionBatchActive,
  sessionBatchSelectedCount,
  onEnterSessionBatch,
  onExitSessionBatch,
  onConfirmBatchDelete,
  onCreateSession,
  onOpenConversation,
  onToggleSessionSelect,
  isSessionSelected,
  menuSessionId,
  onMenuSessionIdChange,
  onOpenSessionRename,
  onCopySession,
  onConfirmDeleteSession,
  onOpenFileEditor,
}: ChatSessionListPanelProps) {
  const projectVfsScope = useMemo((): VfsScope | null => {
    if (projectId == null) {
      return null;
    }
    return {kind: 'project', projectId};
  }, [projectId]);

  // 同 ChatConversationPanel：把项目工作区的「可回上级目录」状态注册进
  // WorkspaceBackCtx，供 Android 返回键逐级退目录；面板不可见时注销，
  // 避免与聊天工作区的注册相互覆盖。
  const projectVfsRef = useRef<VfsFileManagerHandle | null>(null);
  const setWorkspaceBackState = useChatTabWorkspaceBackState();

  // ===== 后台停止入口（Step 6）：订阅 manager 判活 =====
  // 活跃 run 会话集合（starting|running 单元）：长按菜单的「停止生成」仅对
  // 集合内的会话出现；变更经 manager.subscribe 通知（受理/收尾/替换均触发，
  // 低频，整表重渲染可接受）。
  const runtime = useRuntime();
  const manager = runtime.sessionStreamUnitManager;
  const [activeRunIds, setActiveRunIds] = useState<ReadonlySet<string>>(
    () => new Set(manager.activeSessionIds()),
  );
  useEffect(() => {
    const sync = () =>
      setActiveRunIds(new Set(manager.activeSessionIds()));
    sync();
    return manager.subscribe(sync);
  }, [manager]);

  // ===== 中断徽标数据源（Step 9）：同 activeRunIds 的订阅模式 =====
  // 中断态会话集合（水合回填的 interrupted 单元）：「已中断」徽标的唯一
  // 判据；变更同样经 manager.subscribe 通知驱动刷新。
  const [interruptedRunIds, setInterruptedRunIds] = useState<
    ReadonlySet<string>
  >(() => new Set(manager.interruptedSessionIds()));
  useEffect(() => {
    const sync = () =>
      setInterruptedRunIds(new Set(manager.interruptedSessionIds()));
    sync();
    return manager.subscribe(sync);
  }, [manager]);

  const onStopGenerating = useCallback(
    (sid: string) => {
      // 走单元的 abort 语义（retain/freeze 时序由 core 负责）；后续
      // FINISHED 照常经事件路径收尾（投影回落、集合更新、按钮消失）。
      manager.stopRun(sid);
    },
    [manager],
  );

  const emitWorkspaceBackState = useCallback(() => {
    if (setWorkspaceBackState == null) {
      return;
    }
    if (!visible || sessionListPanel !== 'projects') {
      setWorkspaceBackState(null);
      return;
    }
    const handle = projectVfsRef.current;
    if (!handle) {
      setWorkspaceBackState(null);
      return;
    }
    setWorkspaceBackState({
      canGoUp: handle.canGoUp(),
      goUp: () => handle.goUp(),
    });
  }, [visible, sessionListPanel, setWorkspaceBackState]);

  useEffect(() => {
    emitWorkspaceBackState();
  }, [emitWorkspaceBackState, vfsRefreshKey]);

  return (
    <View
      style={[styles.subviewFill, !visible && styles.panelHidden]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <SegmentedControl
        tokens={tokens}
        value={sessionListPanel}
        onChange={onSessionListPanelChange}
        options={[
          {value: 'sessions', label: '会话', testID: 'tab-sessions'},
          {value: 'projects', label: '项目工作区', testID: 'tab-projects'},
        ]}
      />
      {sessionListPanel === 'projects' ? (
        projectVfs && projectWorktree && projectId != null ? (
          <View style={styles.flexFill}>
            <VfsFileManager
              key={`project-template-${vfsRefreshKey}`}
              ref={projectVfsRef}
              scope={projectVfsScope!}
              vfs={projectVfs}
              workplace={projectWorktree}
              rootPath="/"
              onOpenFile={path => onOpenFileEditor(path, 'project')}
              onDirectoryChange={emitWorkspaceBackState}
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
            batchMode={sessionBatchActive}
            selectedCount={sessionBatchSelectedCount}
            onEnterBatch={onEnterSessionBatch}
            onCancelBatch={onExitSessionBatch}
            onDelete={onConfirmBatchDelete}
            hint="选择要删除的会话"
            normalActions={
              <PrimaryButton
                label="新建会话"
                tokens={tokens}
                onPress={onCreateSession}
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
              // 徽标两态判定：running（该会话真有 run 在跑）→「生成中」徽标；
              // interrupted（无论是否当前会话，水合回填的中断现场）→「已中断」
              // 徽标；「当前」位置徽标与运行态正交，照常按 isCurrent 出。
              const isRunning = activeRunIds.has(item.id);
              const isInterrupted = !isRunning && interruptedRunIds.has(item.id);
              // 「 · 活跃中」meta 的唯一判据是 isRunning——即 manager 的真实
              // 判活（starting|running 单元集合），**不是** isCurrent。
              //
              // 挂在 isCurrent 上时它退化成「当前会话」标记，与运行态彻底解耦
              // （2026-09-30 真机实录 GWT-7）：run 于 11:38:48 收尾、单元 settle
              // 出 active 集后 4 分钟仍显示；app 重启后 session_run_state 只有
              // settled 行、既无 active 也无 interrupted 可水合，照样显示——
              // 用户把「27 分钟前 · 活跃中」读成 run 卡死。挂在 isRunning 上，
              // 收尾即隐、重启不凭空出现、真在跑照常显示。
              const showsActiveMeta = isRunning;
              return (
                <Pressable
                  style={[
                    styles.sessionCard,
                    {
                      backgroundColor: tokens.surfaceElevated,
                      borderColor: tokens.borderLight,
                    },
                    isSessionSelected(item.id) && {
                      borderColor: tokens.primary,
                      borderWidth: 2,
                    },
                  ]}
                  onPress={() => {
                    if (sessionBatchActive) {
                      onToggleSessionSelect(item.id);
                    } else {
                      onOpenConversation(item.id);
                    }
                  }}
                  onLongPress={() => {
                    onEnterSessionBatch();
                    onToggleSessionSelect(item.id);
                  }}
                >
                  {sessionBatchActive ? (
                    <BatchCheckbox
                      checked={isSessionSelected(item.id)}
                      onToggle={() => onToggleSessionSelect(item.id)}
                    />
                  ) : null}
                  <View style={styles.sessionInfo}>
                    <Text
                      style={[styles.sessionTitle, {color: tokens.text}]}
                      numberOfLines={1}
                    >
                      {item.title ?? item.id}
                    </Text>
                    <Text
                      style={[
                        styles.sessionMeta,
                        {color: tokens.textSecondary},
                      ]}
                    >
                      {formatRelativeTimeMs(item.updatedAtMs)}
                      {showsActiveMeta ? ' · 活跃中' : ''}
                    </Text>
                  </View>
                  {isRunning ? (
                    <View
                      style={[
                        styles.generatingBadge,
                        {backgroundColor: tokens.primary},
                      ]}
                    >
                      <Text style={styles.currentBadgeText}>生成中</Text>
                    </View>
                  ) : null}
                  {isInterrupted ? (
                    <View
                      style={[
                        styles.interruptedBadge,
                        {backgroundColor: tokens.textSecondary},
                      ]}
                    >
                      <Text style={styles.currentBadgeText}>已中断</Text>
                    </View>
                  ) : null}
                  {isCurrent && !sessionBatchActive ? (
                    <View
                      style={[
                        styles.currentBadge,
                        {backgroundColor: tokens.primary},
                      ]}
                    >
                      <Text style={styles.currentBadgeText}>当前</Text>
                    </View>
                  ) : null}
                  {!sessionBatchActive ? (
                    <>
                      <Pressable
                        hitSlop={8}
                        onPress={e => {
                          e.stopPropagation?.();
                          onMenuSessionIdChange(item.id);
                        }}
                      >
                        <Text
                          style={[
                            styles.menuDots,
                            {color: tokens.textSecondary},
                          ]}
                        >
                          ⋮
                        </Text>
                      </Pressable>
                      <Text
                        style={[styles.chevron, {color: tokens.textTertiary}]}
                      >
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
            items={
              menuSessionId != null && activeRunIds.has(menuSessionId)
                ? [
                    {label: '停止生成', action: 'stop-generating'},
                    {label: '重命名', action: 'rename'},
                    {label: '复制', action: 'copy'},
                    {label: '删除', action: 'delete', danger: true},
                  ]
                : [
                    {label: '重命名', action: 'rename'},
                    {label: '复制', action: 'copy'},
                    {label: '删除', action: 'delete', danger: true},
                  ]
            }
            onClose={() => onMenuSessionIdChange(undefined)}
            onSelect={action => {
              const sid = menuSessionId;
              onMenuSessionIdChange(undefined);
              if (sid == null) {
                return;
              }
              if (action === 'stop-generating') {
                onStopGenerating(sid);
              } else if (action === 'rename') {
                onOpenSessionRename(sid);
              } else if (action === 'copy') {
                onCopySession(sid);
              } else if (action === 'delete') {
                onConfirmDeleteSession(sid);
              }
            }}
          />
        </>
      )}
    </View>
  );
}

export const ChatSessionListPanel = React.memo(ChatSessionListPanelInner);

const styles = StyleSheet.create({
  subviewFill: {flex: 1, minHeight: 0},
  panelHidden: {display: 'none'},
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
  generatingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    // 与 interruptedBadge/currentBadge 一致的右侧间距：多徽标同排不贴死（ui/J-1）。
    marginRight: 4,
  },
  /** 中断徽标（Step 9）：中性色区分于进行中的主色。 */
  interruptedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 4,
  },
  menuDots: {fontSize: 18, paddingHorizontal: 4},
  chevron: {fontSize: 22, fontWeight: '300'},
  empty: {textAlign: 'center', marginTop: 32},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
});
