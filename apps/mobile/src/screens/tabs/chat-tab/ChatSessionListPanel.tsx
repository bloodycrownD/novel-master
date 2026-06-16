/**
 * Chat tab sessions subview: project banner, session list, template workspace.
 */
import React, {useMemo} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type ChatProject, type ChatSession } from "@novel-master/core/chat";

import { type VfsScope, type VfsService } from "@novel-master/core/vfs";

import { type WorktreeService } from "@novel-master/core/worktree";
import {BottomSheetMenu} from '../../../components/sheet/BottomSheetMenu';
import {ManageHeader} from '../../../components/batch/ManageHeader';
import {BatchCheckbox} from '../../../components/batch/BatchCheckbox';
import {SegmentedControl} from '../../../components/ui/SegmentedControl';
import {PrimaryButton} from '../../../components/ui/PrototypeButtons';
import {VfsFileManager} from '../../../components/vfs/VfsFileManager';
import type {ThemeTokens} from '../../../theme/tokens';
import {formatRelativeTimeMs} from '../../../utils/format-relative-time';
import type {SessionListPanel} from './useChatTabScope';

export type ChatSessionListPanelProps = {
  tokens: ThemeTokens;
  visible: boolean;
  currentProject: ChatProject | undefined;
  sessionListPanel: SessionListPanel;
  onSessionListPanelChange: (panel: SessionListPanel) => void;
  onOpenProjectDrawer: () => void;
  projectId: string | undefined;
  sessionId: string | undefined;
  sessions: ChatSession[];
  vfsRefreshKey: number;
  projectVfs: VfsService | null;
  projectWorktree: WorktreeService | null;
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
  bumpVfsRefresh: () => void;
  onOpenFileEditor: (path: string, scopeKind: 'project' | 'session') => void;
};

function ChatSessionListPanelInner({
  tokens,
  visible,
  currentProject,
  sessionListPanel,
  onSessionListPanelChange,
  onOpenProjectDrawer,
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
  bumpVfsRefresh,
  onOpenFileEditor,
}: ChatSessionListPanelProps) {
  const projectVfsScope = useMemo((): VfsScope | null => {
    if (projectId == null) {
      return null;
    }
    return {kind: 'project', projectId};
  }, [projectId]);

  const projectPullFromParent = useMemo(() => {
    if (projectId == null) {
      return undefined;
    }
    return {
      scope: {kind: 'project' as const, projectId},
      onPulled: bumpVfsRefresh,
    };
  }, [projectId, bumpVfsRefresh]);

  return (
    <View
      style={[styles.subviewFill, !visible && styles.panelHidden]}
      pointerEvents={visible ? 'auto' : 'none'}>
      {currentProject ? (
        <Pressable
          style={[
            styles.projectBanner,
            {
              backgroundColor: tokens.surfaceElevated,
              borderBottomColor: tokens.borderLight,
            },
          ]}
          onPress={onOpenProjectDrawer}>
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
        onChange={onSessionListPanelChange}
        options={[
          {value: 'sessions', label: '会话'},
          {value: 'template', label: '项目工作区'},
        ]}
      />
      {sessionListPanel === 'template' ? (
        projectVfs && projectWorktree && projectId != null ? (
          <View style={styles.flexFill}>
            <VfsFileManager
              key={`project-template-${vfsRefreshKey}`}
              scope={projectVfsScope!}
              vfs={projectVfs}
              worktree={projectWorktree}
              rootPath="/"
              pullFromParent={projectPullFromParent}
              onOpenFile={path => onOpenFileEditor(path, 'project')}
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
                  }}>
                  {sessionBatchActive ? (
                    <BatchCheckbox
                      checked={isSessionSelected(item.id)}
                      onToggle={() => onToggleSessionSelect(item.id)}
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
                  {isCurrent && !sessionBatchActive ? (
                    <View
                      style={[
                        styles.currentBadge,
                        {backgroundColor: tokens.primary},
                      ]}>
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
            onClose={() => onMenuSessionIdChange(undefined)}
            onSelect={action => {
              const sid = menuSessionId;
              onMenuSessionIdChange(undefined);
              if (sid == null) {
                return;
              }
              if (action === 'rename') {
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
});
