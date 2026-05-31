/**
 * Agent registry list with default marker and context menu.
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
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {useRuntime} from '../../hooks/useRuntime';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface AgentRow {
  id: string;
  def: AgentDefinition;
  meta: string;
  isDefault: boolean;
}

function agentMeta(def: AgentDefinition, modelLabel: string, workspace: boolean): string {
  const steps = def.runtime?.maxSteps ?? 20;
  const modelPart = workspace ? `${modelLabel} · 工作区` : modelLabel;
  return `${modelPart} · maxSteps ${steps}`;
}

type Props = {
  onCreate?: () => void;
};

export function AgentList({onCreate}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuAgentId, setMenuAgentId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await runtime.agentRegistry.listAgentIds();
      const currentId = await runtime.state.getCurrentAgentId();
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
        const def = await runtime.agentRegistry.get(id);
        let meta: string;
        if (def.model) {
          let label = def.model;
          try {
            label = await resolveModelDisplayLabel(runtime, def.model);
          } catch {
            /* use raw id */
          }
          meta = agentMeta(def, label, false);
        } else {
          meta = agentMeta(def, workspaceLabel, true);
        }
        enriched.push({
          id,
          def,
          meta,
          isDefault: currentId === id || (!currentId && ids[0] === id),
        });
      }
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => setRows([]));
    }, [reload]),
  );

  const handleSetDefault = async (agentId: string) => {
    await runtime.state.setCurrentAgentId(agentId);
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
            Alert.alert(
              '删除失败',
              err instanceof Error ? err.message : String(err),
            ),
          );
        },
      },
    ]);
  };

  const menuItems = (agentId: string, isDefault: boolean) => {
    const items = [];
    if (!isDefault) {
      items.push({label: '设为默认', action: 'set-default'});
    }
    items.push({label: '复制', action: 'duplicate'});
    items.push({label: '删除', action: 'delete', danger: true});
    return items;
  };

  return (
    <View style={styles.root}>
      {onCreate ? (
        <View style={[styles.toolbar, {borderBottomColor: tokens.border}]}>
          <Pressable
            style={[styles.createBtn, {backgroundColor: tokens.primary}]}
            onPress={onCreate}>
            <Text style={styles.createBtnText}>新建</Text>
          </Pressable>
        </View>
      ) : null}
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无 Agent，点击「新建」创建。
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={[styles.row, {borderBottomColor: tokens.border}]}
              onPress={() =>
                navigation.navigate('AgentEditor', {agentId: item.id})
              }>
              <View style={styles.info}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.def.name}
                </Text>
                <Text style={[styles.meta, {color: tokens.textSecondary}]}>
                  {item.meta}
                </Text>
              </View>
              {item.isDefault ? (
                <Text style={[styles.badge, {color: tokens.primary}]}>
                  默认
                </Text>
              ) : null}
              <Pressable
                hitSlop={8}
                onPress={e => {
                  e.stopPropagation?.();
                  setMenuAgentId(item.id);
                }}>
                <Text style={{color: tokens.textSecondary, fontSize: 18}}>
                  ⋮
                </Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
      <BottomSheetMenu
        visible={menuAgentId != null}
        items={
          menuAgentId
            ? menuItems(
                menuAgentId,
                rows.find(r => r.id === menuAgentId)?.isDefault ?? false,
              )
            : []
        }
        onClose={() => setMenuAgentId(undefined)}
        onSelect={action => {
          const id = menuAgentId;
          setMenuAgentId(undefined);
          if (!id) {
            return;
          }
          if (action === 'set-default') {
            handleSetDefault(id).catch(() => undefined);
          } else if (action === 'duplicate') {
            handleDuplicate(id).catch(() => undefined);
          } else if (action === 'delete') {
            handleDelete(id).catch(() => undefined);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  createBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createBtnText: {color: '#fff', fontWeight: '600'},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  info: {flex: 1, gap: 2},
  name: {fontSize: 16, fontWeight: '500'},
  meta: {fontSize: 12},
  badge: {fontSize: 12, fontWeight: '600'},
});
