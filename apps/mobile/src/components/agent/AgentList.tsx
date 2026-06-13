/**
 * Agent registry list with context menu (rename, duplicate, delete).
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {AgentDefinition} from '@novel-master/core';
import {AGENT_LIST_LABELS} from '@novel-master/core/config-forms/shared';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {ManageHeader} from '../batch/ManageHeader';
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {ElevatedCard} from '../ui/ElevatedCard';
import {PrimaryButton} from '../ui/PrototypeButtons';
import {TextPromptModal} from '../ui/TextPromptModal';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useDismissOverlaysOnBlur} from '../../hooks/useDismissOverlaysOnBlur';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {pickEntityIcon} from '../../utils/entity-icon';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface AgentRow {
  id: string;
  name: string;
  def?: AgentDefinition;
  decodeError?: string;
  meta: string;
}

const AGENT_ICONS = ['🤖', '⚡', '📝', '🎯', '✨', '🚀'];

function agentMeta(def: AgentDefinition, modelLabel: string, workspace: boolean): string {
  const steps = def.runtime?.maxSteps ?? 20;
  const modelPart = workspace ? `${modelLabel} · 工作区` : modelLabel;
  return `${modelPart} · ${AGENT_LIST_LABELS.maxSteps(steps)}`;
}

type Props = {
  onCreate?: () => void;
};

export function AgentList({onCreate}: Props) {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuAgentId, setMenuAgentId] = useState<string | undefined>();
  const [renamePrompt, setRenamePrompt] = useState<
    {agentId: string; initialName: string} | undefined
  >();
  const batch = useBatchSelection();

  const dismissAllOverlays = useCallback(() => {
    setMenuAgentId(undefined);
    setRenamePrompt(undefined);
  }, []);

  useDismissOverlaysOnBlur(dismissAllOverlays);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await runtime.agentRegistry.listAgentIds();
      const workspaceModelId = await runtime.state.getCurrentModelId();
      let workspaceLabel = '—';
      if (workspaceModelId) {
        try {
          workspaceLabel = await resolveModelDisplayLabel(
            runtime,
            workspaceModelId,
          );
        } catch {
          workspaceLabel = workspaceModelId;
        }
      }
      const enriched: AgentRow[] = [];
      for (const id of ids) {
        try {
          const def = await runtime.agentRegistry.get(id);
          let meta: string;
          if (def.model) {
            let label = def.model;
            try {
              label = await resolveModelDisplayLabel(runtime, def.model);
            } catch {
              /* 使用原始 model id */
            }
            meta = agentMeta(def, label, false);
          } else {
            meta = agentMeta(def, workspaceLabel, true);
          }
          enriched.push({
            id,
            name: def.name?.trim() || id,
            def,
            meta,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          enriched.push({
            id,
            name: id,
            decodeError: message,
            meta: AGENT_LIST_LABELS.needsRepair,
          });
        }
      }
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(err =>
        showToast(toastMessage('加载 Agent 列表失败', err)),
      );
    }, [reload, showToast]),
  );

  const handleRename = async (agentId: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    const def = await runtime.agentRegistry.get(agentId);
    await runtime.agentRegistry.upsert(agentId, {...def, name: trimmed});
    await reload();
  };

  const handleDuplicate = async (agentId: string) => {
    const def = await runtime.agentRegistry.get(agentId);
    const copyId = `agent-${Date.now()}`;
    await runtime.agentRegistry.upsert(copyId, {
      ...def,
      name: `${def.name}-copy`,
    });
    await reload();
    navigation.navigate('AgentEditor', {agentId: copyId});
  };

  const handleDelete = async (agentId: string) => {
    Alert.alert('删除 Agent', `确定删除 ${agentId}？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            const currentId = await runtime.state.getCurrentAgentId();
            const ids = await runtime.agentRegistry.listAgentIds();
            await runtime.agentRegistry.delete(agentId);
            if (currentId === agentId) {
              const remaining = ids.filter(id => id !== agentId);
              if (remaining.length > 0) {
                await runtime.state.setCurrentAgentId(remaining[0]);
              } else {
                await runtime.state.resetCurrentAgentId();
              }
            }
            await reload();
          })().catch(err =>
            showToast(toastMessage('删除失败', err)),
          );
        },
      },
    ]);
  };

  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert('删除 Agent', `确定删除选中的 ${ids.length} 个 Agent？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            const currentId = await runtime.state.getCurrentAgentId();
            for (const agentId of ids) {
              await runtime.agentRegistry.delete(agentId);
            }
            if (currentId && ids.includes(currentId)) {
              const remaining = (await runtime.agentRegistry.listAgentIds()).filter(
                id => !ids.includes(id),
              );
              if (remaining.length > 0) {
                await runtime.state.setCurrentAgentId(remaining[0]!);
              } else {
                await runtime.state.resetCurrentAgentId();
              }
            }
            batch.exit();
            await reload();
          })().catch(err =>
            showToast(toastMessage('删除失败', err)),
          );
        },
      },
    ]);
  };

  const menuItems = () => [
    {label: '重命名', action: 'rename'},
    {label: '复制', action: 'duplicate'},
    {label: '删除', action: 'delete', danger: true},
  ];

  return (
    <View style={styles.root}>
      <ManageHeader
        title="Agent"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={confirmBatchDelete}
        hint="选择要删除的 Agent"
        normalActions={
          onCreate ? (
            <PrimaryButton label="新建" tokens={tokens} onPress={onCreate} />
          ) : null
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无 Agent，点击「新建」创建。
            </Text>
          }
          renderItem={({item, index}) => (
            <ElevatedCard
              tokens={tokens}
              selected={batch.isSelected(item.id)}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.id);
                } else {
                  navigation.navigate('AgentEditor', {agentId: item.id});
                }
              }}>
              {batch.active ? (
                <BatchCheckbox
                  checked={batch.isSelected(item.id)}
                  onToggle={() => batch.toggle(item.id)}
                />
              ) : (
                <View
                  style={[
                    styles.avatar,
                    {backgroundColor: tokens.bgSecondary},
                  ]}>
                  <Text style={styles.avatarIcon}>
                    {pickEntityIcon(item.id, AGENT_ICONS)}
                  </Text>
                </View>
              )}
              <View style={styles.info}>
                <Text
                  style={[styles.name, {color: tokens.text}]}
                  numberOfLines={1}>
                  {item.name}
                </Text>
                <Text
                  style={[styles.meta, {color: tokens.textSecondary}]}
                  numberOfLines={2}>
                  {item.meta}
                </Text>
              </View>
              {!batch.active ? (
                <>
                  <Pressable
                    hitSlop={8}
                    onPress={e => {
                      e.stopPropagation?.();
                      setMenuAgentId(item.id);
                    }}>
                    <Text
                      style={[styles.menuDots, {color: tokens.textSecondary}]}>
                      ⋮
                    </Text>
                  </Pressable>
                  <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
                    ›
                  </Text>
                </>
              ) : null}
            </ElevatedCard>
          )}
        />
      )}
      <BottomSheetMenu
        visible={menuAgentId != null}
        items={menuAgentId ? menuItems() : []}
        onClose={() => setMenuAgentId(undefined)}
        onSelect={action => {
          const id = menuAgentId;
          setMenuAgentId(undefined);
          if (!id) {
            return;
          }
          if (action === 'rename') {
            const row = rows.find(r => r.id === id);
            if (row) {
              setRenamePrompt({agentId: id, initialName: row.name});
            }
          } else if (action === 'duplicate') {
            handleDuplicate(id).catch(() => undefined);
          } else if (action === 'delete') {
            handleDelete(id).catch(() => undefined);
          }
        }}
      />
      <TextPromptModal
        visible={renamePrompt != null}
        title="重命名 Agent"
        label="显示名称"
        placeholder="Agent 名称"
        initialValue={renamePrompt?.initialName ?? ''}
        confirmLabel="保存"
        onClose={() => setRenamePrompt(undefined)}
        onConfirm={async value => {
          const prompt = renamePrompt;
          setRenamePrompt(undefined);
          if (prompt) {
            await handleRename(prompt.agentId, value);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  listContent: {paddingBottom: 24},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 32},
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: {fontSize: 22},
  info: {flex: 1, minWidth: 0, gap: 4},
  name: {fontSize: 16, fontWeight: '600'},
  meta: {fontSize: 13, lineHeight: 18},
  menuDots: {fontSize: 18, paddingHorizontal: 4},
  chevron: {fontSize: 22, fontWeight: '300'},
});
