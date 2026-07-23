/**
 * Left-side project drawer (examples/mobile .side-drawer.project-drawer).
 */
import React, {useEffect, useState} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import { type ChatProject } from "@novel-master/core/chat";
import {AppModal} from '../ui/AppModal';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {ManageHeader} from '../batch/ManageHeader';
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {PrimaryButton} from '../ui/PrototypeButtons';
import {TextPromptModal} from '../ui/TextPromptModal';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {formatRelativeTimeMs} from '../../utils/format-relative-time';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {pickEntityIcon} from '../../utils/entity-icon';

const PROJECT_ICONS = ['📁', '📚', '✨', '🚀', '📝', '🎯'];

type NamePromptState =
  | {mode: 'create'}
  | {mode: 'rename'; projectId: string; initialName: string};

type Props = {
  visible: boolean;
  projects: ChatProject[];
  currentProjectId: string | undefined;
  onClose: () => void;
  onSelect: (projectId: string) => void;
  onCreateProject: (name: string) => void | Promise<void>;
  onRenameProject: (projectId: string, name: string) => void | Promise<void>;
  onDeleteSelected: (projectIds: string[]) => void | Promise<void>;
  onOpenAgentConfig?: (projectId: string) => void;
};

export function ProjectDrawer({
  visible,
  projects,
  currentProjectId,
  onClose,
  onSelect,
  onCreateProject,
  onRenameProject,
  onDeleteSelected,
  onOpenAgentConfig,
}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const insets = useSafeAreaInsets();
  const batch = useBatchSelection();
  const [namePrompt, setNamePrompt] = useState<NamePromptState | null>(null);
  const [menuProjectId, setMenuProjectId] = useState<string | undefined>();

  useEffect(() => {
    if (!visible) {
      batch.exit();
      setNamePrompt(null);
      setMenuProjectId(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when drawer closes
  }, [visible]);

  const menuProject = projects.find(p => p.id === menuProjectId);

  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert(
      '确认删除',
      `确定删除选中的 ${ids.length} 个项目？将同时移除其下所有会话。`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void Promise.resolve(onDeleteSelected(ids)).then(() => {
              batch.exit();
            });
          },
        },
      ],
    );
  };

  return (
    <>
      <AppModal
        visible={visible}
        animationType="fade"
        transparent
        onRequestClose={onClose}>
        <View style={styles.root}>
          <View
            style={[
              styles.drawer,
              {
                backgroundColor: tokens.surface,
                paddingTop: insets.top,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}>
            <ManageHeader
              title="项目"
              batchMode={batch.active}
              selectedCount={batch.selectedCount}
              onEnterBatch={batch.enter}
              onCancelBatch={batch.exit}
              onDelete={confirmBatchDelete}
              hint="选择要删除的项目（将同时移除其下所有会话）"
              normalActions={
                <PrimaryButton
                  label="新建"
                  tokens={tokens}
                  onPress={() => setNamePrompt({mode: 'create'})}
                />
              }
            />
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled">
              {projects.length === 0 ? (
                <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                  暂无项目，点击「新建」开始。
                </Text>
              ) : (
                projects.map((project, index) => {
                  const isCurrent = project.id === currentProjectId;
                  const selected = batch.isSelected(project.id);
                  return (
                    <Pressable
                      key={project.id}
                      style={[
                        styles.projectCard,
                        {
                          backgroundColor: tokens.surfaceElevated,
                          borderColor: selected
                            ? tokens.primary
                            : tokens.borderLight,
                          borderWidth: selected
                            ? 2
                            : StyleSheet.hairlineWidth,
                        },
                      ]}
                      onPress={() => {
                        if (batch.active) {
                          batch.toggle(project.id);
                        } else {
                          onSelect(project.id);
                          onClose();
                        }
                      }}>
                      {batch.active ? (
                        <BatchCheckbox
                          checked={selected}
                          onToggle={() => batch.toggle(project.id)}
                        />
                      ) : (
                        <Text style={styles.projectIcon}>
                          {pickEntityIcon(project.id, PROJECT_ICONS)}
                        </Text>
                      )}
                      <View style={styles.projectInfo}>
                        <Text
                          style={[styles.projectName, {color: tokens.text}]}
                          numberOfLines={1}>
                          {project.name}
                        </Text>
                        <Text
                          style={[
                            styles.projectMeta,
                            {color: tokens.textSecondary},
                          ]}>
                          更新于 {formatRelativeTimeMs(project.updatedAtMs)}
                        </Text>
                      </View>
                      {isCurrent && !batch.active ? (
                        <View
                          style={[
                            styles.currentBadge,
                            {backgroundColor: tokens.primary},
                          ]}>
                          <Text style={styles.currentBadgeText}>当前</Text>
                        </View>
                      ) : null}
                      {!batch.active ? (
                        <>
                          <Pressable
                            hitSlop={8}
                            testID={`project-menu-${project.id}`}
                            onPress={e => {
                              e.stopPropagation?.();
                              setMenuProjectId(project.id);
                            }}>
                            <Text
                              style={[
                                styles.menuDots,
                                {color: tokens.textSecondary},
                              ]}>
                              ⋮
                            </Text>
                          </Pressable>
                          <Text
                            style={[
                              styles.chevron,
                              {color: tokens.textTertiary},
                            ]}>
                            ›
                          </Text>
                        </>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
          <Pressable
            style={styles.backdrop}
            onPress={onClose}
            accessibilityLabel="关闭项目列表"
          />
        </View>
      </AppModal>

      <BottomSheetMenu
        visible={menuProjectId != null}
        items={[
          {label: '重命名', action: 'rename'},
          {label: '智能体', action: 'agent-config'},
          {label: '删除', action: 'delete', danger: true},
        ]}
        onClose={() => setMenuProjectId(undefined)}
        onSelect={action => {
          const project = menuProject;
          setMenuProjectId(undefined);
          if (action === 'rename' && project) {
            setNamePrompt({
              mode: 'rename',
              projectId: project.id,
              initialName: project.name,
            });
            return;
          }
          if (action === 'agent-config' && project) {
            onOpenAgentConfig?.(project.id);
            return;
          }
          if (action === 'delete' && project) {
            Alert.alert(
              '确认删除',
              `确定删除项目「${project.name}」？将同时移除其下所有会话。`,
              [
                {text: '取消', style: 'cancel'},
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () => {
                    void Promise.resolve(onDeleteSelected([project.id])).catch(
                      err =>
                        showToast(toastMessage('删除失败', err)),
                    );
                  },
                },
              ],
            );
          }
        }}
      />

      <TextPromptModal
        visible={namePrompt != null}
        title={namePrompt?.mode === 'rename' ? '重命名项目' : '新建项目'}
        label="项目名称"
        placeholder="如 科幻小说创作"
        initialValue={
          namePrompt?.mode === 'rename' ? namePrompt.initialName : ''
        }
        confirmLabel={namePrompt?.mode === 'rename' ? '保存' : '创建'}
        onClose={() => setNamePrompt(null)}
        onConfirm={async name => {
          if (namePrompt?.mode === 'create') {
            await onCreateProject(name);
          } else if (namePrompt?.mode === 'rename') {
            await onRenameProject(namePrompt.projectId, name);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    width: '88%',
    maxWidth: 320,
    shadowColor: '#000',
    shadowOffset: {width: 4, height: 0},
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 16,
  },
  backdrop: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 16,
  },
  empty: {
    textAlign: 'center',
    marginTop: 32,
    fontSize: 14,
    lineHeight: 20,
  },
  projectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 5,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    gap: 8,
  },
  projectIcon: {
    fontSize: 28,
    width: 36,
    textAlign: 'center',
  },
  projectInfo: {
    flex: 1,
    minWidth: 0,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  projectMeta: {
    fontSize: 13,
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 4,
  },
  currentBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  menuDots: {
    fontSize: 18,
    paddingHorizontal: 4,
  },
  chevron: {
    fontSize: 22,
    fontWeight: '300',
  },
});
