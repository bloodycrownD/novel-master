/**
 * Regex groups list with current-group marker.
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
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
import {TextPromptModal} from '../../components/ui/TextPromptModal';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {deriveRegexGroupId} from '../../utils/regex-group-id';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

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
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuGroupId, setMenuGroupId] = useState<string | undefined>();
  const [createVisible, setCreateVisible] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | undefined>();
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
            showToast(toastMessage('删除失败', err)),
          );
        },
      },
    ]);
  };

  const deleteGroup = async (groupId: string) => {
    const title = groupTitle(rows.find(g => g.groupId === groupId) ?? {groupId});
    Alert.alert('删除正则组', `确定删除「${title}」？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            await runtime.regexConfig.deleteGroup(groupId);
            await reload();
          })().catch(err =>
            showToast(toastMessage('删除失败', err)),
          );
        },
      },
    ]);
  };

  const editInitialName =
    editGroupId != null
      ? (rows.find(g => g.groupId === editGroupId)?.displayName ??
        groupTitle(rows.find(g => g.groupId === editGroupId)!))
      : '';

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
          <PrimaryButton
            label="添加"
            tokens={tokens}
            onPress={() => setCreateVisible(true)}
          />
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
              subtitle={`${item.ruleCount} 条规则`}
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
          if (action === 'edit') {
            setEditGroupId(id);
          } else if (action === 'delete') {
            deleteGroup(id).catch(() => undefined);
          }
        }}
      />
      <TextPromptModal
        visible={createVisible}
        title="新建正则组"
        label="名称"
        placeholder="如 对话清洗"
        confirmLabel="创建"
        onClose={() => setCreateVisible(false)}
        onConfirm={async name => {
          const taken = new Set(rows.map(r => r.groupId));
          const groupId = deriveRegexGroupId(name, taken);
          await runtime.regexConfig.createGroup({
            groupId,
            displayName: name,
          });
          await reload();
          showToast('已添加正则组');
        }}
      />
      <TextPromptModal
        visible={editGroupId != null}
        title="编辑名称"
        label="名称"
        placeholder="正则组名称"
        initialValue={editInitialName}
        confirmLabel="保存"
        onClose={() => setEditGroupId(undefined)}
        onConfirm={async name => {
          if (editGroupId == null) {
            return;
          }
          await runtime.regexConfig.updateGroup(editGroupId, {
            displayName: name,
          });
          await reload();
          showToast('已更新名称');
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
  icon: {fontSize: 22},
});
