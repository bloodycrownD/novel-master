/**
 * Regex groups list with current-group marker.
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RegexGroup} from '@novel-master/core';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {PrimaryButton} from '../../components/ui/PrototypeButtons';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface GroupRow extends RegexGroup {
  ruleCount: number;
  isCurrent: boolean;
}

function groupTitle(group: RegexGroup): string {
  return group.displayName?.trim() || group.groupId;
}

export function RegexGroupsScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuGroupId, setMenuGroupId] = useState<string | undefined>();
  const [createVisible, setCreateVisible] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | undefined>();
  const [formGroupId, setFormGroupId] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const batch = useBatchSelection();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const groups = await runtime.regexConfig.listGroups();
      const currentId = await runtime.state.getCurrentRegexGroupId();
      const enriched: GroupRow[] = [];
      for (const group of groups) {
        const rules = await runtime.regexConfig.listRules(group.groupId);
        enriched.push({
          ...group,
          ruleCount: rules.length,
          isCurrent: currentId === group.groupId,
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

  const openCreate = () => {
    setFormGroupId('');
    setFormDisplayName('');
    setCreateVisible(true);
  };

  const openEdit = (groupId: string) => {
    const group = rows.find(g => g.groupId === groupId);
    if (!group) {
      return;
    }
    setFormGroupId(group.groupId);
    setFormDisplayName(group.displayName ?? '');
    setEditGroupId(groupId);
  };

  const confirmCreate = async () => {
    const groupId = formGroupId.trim();
    if (!groupId) {
      Alert.alert('请填写组 ID');
      return;
    }
    try {
      await runtime.regexConfig.createGroup({
        groupId,
        displayName: formDisplayName.trim() || null,
      });
      setCreateVisible(false);
      await reload();
      Alert.alert('已添加正则组');
    } catch (error) {
      Alert.alert(
        '创建失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const confirmEdit = async () => {
    if (!editGroupId) {
      return;
    }
    try {
      await runtime.regexConfig.updateGroup(editGroupId, {
        displayName: formDisplayName.trim() || null,
      });
      setEditGroupId(undefined);
      await reload();
      Alert.alert('已更新展示名称');
    } catch (error) {
      Alert.alert(
        '更新失败',
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const setCurrent = async (groupId: string) => {
    await runtime.state.setCurrentRegexGroupId(groupId);
    await reload();
    Alert.alert('已设为当前生效正则组');
  };

  const confirmBatchDelete = () => {
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert('删除正则组', `确定删除选中的 ${ids.length} 个正则组？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            for (const groupId of ids) {
              await runtime.regexConfig.deleteGroup(groupId);
            }
            batch.exit();
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

  const deleteGroup = async (groupId: string) => {
    Alert.alert('删除正则组', `确定删除 ${groupId}？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            await runtime.regexConfig.deleteGroup(groupId);
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

  const GroupModal = ({
    visible,
    title,
    idEditable,
    onClose,
    onConfirm,
  }: {
    visible: boolean;
    title: string;
    idEditable: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }) => (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.modalSheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.modalTitle, {color: tokens.text}]}>
            {title}
          </Text>
          {idEditable ? (
            <>
              <Text style={[styles.label, {color: tokens.textSecondary}]}>
                组 ID
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {color: tokens.text, borderColor: tokens.border},
                ]}
                value={formGroupId}
                onChangeText={setFormGroupId}
                autoCapitalize="none"
              />
            </>
          ) : (
            <Text style={[styles.hint, {color: tokens.textSecondary}]}>
              组 ID：{formGroupId}
            </Text>
          )}
          <Text style={[styles.label, {color: tokens.textSecondary}]}>
            展示名称
          </Text>
          <TextInput
            style={[
              styles.input,
              {color: tokens.text, borderColor: tokens.border},
            ]}
            value={formDisplayName}
            onChangeText={setFormDisplayName}
          />
          <View style={styles.modalActions}>
            <Pressable onPress={onClose}>
              <Text style={{color: tokens.textSecondary}}>取消</Text>
            </Pressable>
            <Pressable onPress={onConfirm}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                确定
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="正则组"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={confirmBatchDelete}
        hint="选择要删除的正则组"
        normalActions={
          <PrimaryButton label="添加" tokens={tokens} onPress={openCreate} />
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.groupId}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无正则组，点击「添加」创建。
            </Text>
          }
          renderItem={({item}) => (
            <ConfigListCard
              tokens={tokens}
              selected={batch.isSelected(item.groupId)}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.groupId);
                } else {
                  navigation.navigate('RegexRules', {groupId: item.groupId});
                }
              }}
              leading={
                batch.active ? (
                  <BatchCheckbox
                    checked={batch.isSelected(item.groupId)}
                    onToggle={() => batch.toggle(item.groupId)}
                  />
                ) : (
                  <Text style={styles.icon}>🛡️</Text>
                )
              }
              title={groupTitle(item)}
              subtitle={`${item.groupId} · ${item.ruleCount} 条规则`}
              badge={item.isCurrent && !batch.active ? '当前' : undefined}
              onMenuPress={
                batch.active ? undefined : () => setMenuGroupId(item.groupId)
              }
            />
          )}
        />
      )}
      <BottomSheetMenu
        visible={menuGroupId != null}
        items={[
          ...(rows.find(r => r.groupId === menuGroupId && !r.isCurrent)
            ? [{label: '设为当前', action: 'set-current'}]
            : []),
          {label: '编辑名称', action: 'edit'},
          {label: '删除', action: 'delete', danger: true},
        ]}
        onClose={() => setMenuGroupId(undefined)}
        onSelect={action => {
          const id = menuGroupId;
          setMenuGroupId(undefined);
          if (!id) {
            return;
          }
          if (action === 'set-current') {
            setCurrent(id).catch(() => undefined);
          } else if (action === 'edit') {
            openEdit(id);
          } else if (action === 'delete') {
            deleteGroup(id).catch(() => undefined);
          }
        }}
      />
      <GroupModal
        visible={createVisible}
        title="新建正则组"
        idEditable
        onClose={() => setCreateVisible(false)}
        onConfirm={() => confirmCreate().catch(() => undefined)}
      />
      <GroupModal
        visible={editGroupId != null}
        title="编辑正则组"
        idEditable={false}
        onClose={() => setEditGroupId(undefined)}
        onConfirm={() => confirmEdit().catch(() => undefined)}
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
  listContent: {paddingBottom: 24},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 32},
  icon: {fontSize: 22},
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
    gap: 8,
  },
  modalTitle: {fontSize: 18, fontWeight: '600', textAlign: 'center'},
  label: {fontSize: 13},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  hint: {fontSize: 13},
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 12,
  },
});
