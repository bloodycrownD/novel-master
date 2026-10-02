/**
 * Chat tab 会话列表面板的**壳**（chat-webview-unify 第二阶段 wave-2 之后）。
 *
 * ## 会话列表本体去哪了
 *
 * 会话列表的渲染整体搬进了 `chat-conversation` 文档（web 侧
 * `webview/session-list.ts`）：ManageHeader 标题、新建按钮、会话行、徽标、空态、
 * 长按进批量、⋮ 点击命中——全都是文档内的一部分。RN 这边只留下 spec §范围
 * 明确「留 RN」的东西：
 *
 * | 保留（在本文件） | 迁走 |
 * |---|---|
 * | 「会话 / 项目工作区」SegmentedControl | ManageHeader（标题 + 新建 + 批量条） |
 * | projects 分支的 VfsFileManager | 会话行 FlatList（含三徽标 / 相对时间 / ⋮ / ›） |
 * | projects 分支的 WorkspaceBackCtx 注册 | 批量勾选 UI（勾选态真源仍在本屏，只是渲染搬进 web） |
 * | projects 分支的返回键逐级退目录 | 会话行 ⋮ 的 BottomSheetMenu（迁到 ChatConversationPanel） |
 *
 * **布局**：本文件被拆成两个导出，不是一个组件的两处调用——因为它们必须待在
 * **不同的渲染位置**：
 * - `ChatSessionListPanel`（切换条）渲染在 `ChatConversationPanel` **上方**，
 *   独占一行高度，其下就是 WebView 透出的列表视图（`display:none` 不占位，
 *   收起时整行消失、列表顶到屏幕顶）；
 * - `ChatSessionListProjectsPanel`（项目工作区）必须**盖在** WebView 之上，
 *   所以它渲染在 `ChatConversationPanel` **下方**、绝对定位铺满内容区。
 *
 * 合成一个组件做不到这点：同一个 flex 列里两个 `flex: 1` 的兄弟会各分一半，
 * 而把切换条挪到工作区覆盖层之上又会露底。要用一个容器包起来才成立，那等于把
 * `ChatTabScreen` 的布局搬进本组件——所以干脆在父层用一层内容区容器收口。
 */
import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {type VfsScope} from '@novel-master/core/vfs';

import {type WorkplaceService} from '@novel-master/core/workplace';
import {SegmentedControl} from '@/components/ui/SegmentedControl';
import {
  VfsFileManager,
  type VfsFileManagerHandle,
} from '@/components/vfs/VfsFileManager';
import type {VfsService} from '@novel-master/core/vfs';
import type {ThemeTokens} from '@/theme/tokens';
import type {SessionListPanel} from './useChatTabScope';
import {useChatTabWorkspaceBackState} from './ChatTabNavigationProvider';

/** 切换条（「会话 / 项目工作区」）：独占一行，其下是 WebView 透出的列表视图。 */
export type ChatSessionListPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
  sessionListPanel: SessionListPanel;
  onSessionListPanelChange: (panel: SessionListPanel) => void;
};

function ChatSessionListPanelInner({
  tokens,
  visible,
  sessionListPanel,
  onSessionListPanelChange,
}: ChatSessionListPanelProps) {
  return (
    <View
      style={!visible && styles.panelHidden}
      pointerEvents={visible ? 'auto' : 'none'}>
      <SegmentedControl
        tokens={tokens}
        value={sessionListPanel}
        onChange={onSessionListPanelChange}
        options={[
          {value: 'sessions', label: '会话', testID: 'tab-sessions'},
          {value: 'projects', label: '项目工作区', testID: 'tab-projects'},
        ]}
      />
    </View>
  );
}

export const ChatSessionListPanel = React.memo(ChatSessionListPanelInner);

/** 项目工作区分支：绝对定位盖满内容区（盖在 WebView 之上）。 */
export type ChatSessionListProjectsPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
  sessionListPanel: SessionListPanel;
  projectId: string | undefined;
  vfsRefreshKey: number;
  projectVfs: VfsService | null;
  projectWorktree: WorkplaceService | null;
  onOpenFileEditor: (path: string, scopeKind: 'project' | 'session') => void;
};

function ChatSessionListProjectsPanelInner({
  tokens,
  visible,
  sessionListPanel,
  projectId,
  vfsRefreshKey,
  projectVfs,
  projectWorktree,
  onOpenFileEditor,
}: ChatSessionListProjectsPanelProps) {
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

  const active = visible && sessionListPanel === 'projects';

  const emitWorkspaceBackState = useCallback(() => {
    if (setWorkspaceBackState == null) {
      return;
    }
    if (!active) {
      setWorkspaceBackState(null);
      return;
    }
    const handle = projectVfsRef.current;
    if (handle == null) {
      setWorkspaceBackState(null);
      return;
    }
    setWorkspaceBackState({
      canGoUp: handle.canGoUp(),
      goUp: () => handle.goUp(),
    });
  }, [active, setWorkspaceBackState]);

  useEffect(() => {
    emitWorkspaceBackState();
  }, [emitWorkspaceBackState, vfsRefreshKey]);

  return (
    <View
      style={[StyleSheet.absoluteFill, !active && styles.panelHidden]}
      pointerEvents={active ? 'auto' : 'none'}>
      {/* 内容分支判据照搬退役前的 `sessionListPanel === 'projects' ? … : …`：
          非 projects 态**不挂载**文件管理器（它会去拉目录树、注册监听），
          只留一个不占位的空覆盖层盖住底下的 WebView。 */}
      {active ? (
        projectVfs && projectWorktree && projectId != null ? (
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
        ) : (
          <View style={styles.placeholder}>
            <Text style={{color: tokens.textSecondary}}>请先选择项目</Text>
          </View>
        )
      ) : null}
    </View>
  );
}

export const ChatSessionListProjectsPanel = React.memo(
  ChatSessionListProjectsPanelInner,
);

const styles = StyleSheet.create({
  panelHidden: {display: 'none'},
  placeholder: {flex: 1, justifyContent: 'center', alignItems: 'center'},
});
