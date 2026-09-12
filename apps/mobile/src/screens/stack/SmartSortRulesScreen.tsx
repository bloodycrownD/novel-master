/**
 * Smart sort rule management: list + toggle + reorder + batch + YAML I/O
 * (spec smart-filename-sort Step 13; drag reorder is a separate node).
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  isBuiltinSmartSortRuleId,
  type SmartSortRule,
} from '@novel-master/core/smart-sort-rule';
import {BatchCheckbox} from '@/components/batch/BatchCheckbox';
import {ManageHeader} from '@/components/batch/ManageHeader';
import {BottomSheetMenu} from '@/components/sheet/BottomSheetMenu';
import {ConfigListCard} from '@/components/ui/ConfigListCard';
import {PrimaryButton, SecondaryButton} from '@/components/ui/Buttons';
import {useBatchDeleteConfirm} from '@/hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '@/hooks/useBatchSelection';
import {useFocusListReload} from '@/hooks/useFocusListReload';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {
  exportSmartSortRuleYaml,
  importSmartSortRuleYaml,
} from '@/services/smart-sort-rule-yaml.service';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SmartSortRulesScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const batch = useBatchSelection();
  /** 行 ⋮ 菜单锚定的规则。 */
  const [menuRule, setMenuRule] = useState<SmartSortRule | null>(null);
  /** 顶栏「更多」菜单（导入/导出/恢复默认）。 */
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);

  const {rows, loading, reload, setRows} = useFocusListReload<SmartSortRule[]>({
    fetcher: useCallback(async () => {
      const list = await runtime.smartSortRule.listRules();
      return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    }, [runtime]),
    fallbackValue: EMPTY_RULES,
    onError: useCallback(
      (cause: unknown) => {
        showToast(toastMessage('加载失败', cause));
      },
      [showToast],
    ),
  });

  const createRule = () => {
    navigation.navigate('SmartSortRuleEditor', {});
  };

  // ---- 行内操作（⋮ 菜单） ----

  const moveRule = useCallback(
    async (ruleId: string, to: 'up' | 'down' | 'top' | 'bottom') => {
      try {
        await runtime.smartSortRule.moveRule(ruleId, to);
        await reload({silent: true});
      } catch (error) {
        showToast(toastMessage('调整失败', error));
      }
    },
    [runtime, reload, showToast],
  );

  const deleteRuleWithConfirm = useCallback(
    (rule: SmartSortRule) => {
      Alert.alert('删除规则', `确定删除「${rule.name}」？`, [
        {text: '取消', style: 'cancel'},
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            (async () => {
              await runtime.smartSortRule.deleteRule(rule.ruleId);
              await reload({silent: true});
            })().catch(error =>
              showToast(toastMessage('删除失败', error)),
            );
          },
        },
      ]);
    },
    [runtime, reload, showToast],
  );

  const handleRowMenuSelect = useCallback(
    (action: string) => {
      const rule = menuRule;
      setMenuRule(null);
      if (!rule) {
        return;
      }
      switch (action) {
        case 'edit':
          navigation.navigate('SmartSortRuleEditor', {ruleId: rule.ruleId});
          break;
        case 'top':
        case 'up':
        case 'down':
        case 'bottom':
          void moveRule(rule.ruleId, action);
          break;
        case 'delete':
          deleteRuleWithConfirm(rule);
          break;
        default:
          break;
      }
    },
    [menuRule, navigation, moveRule, deleteRuleWithConfirm],
  );

  // ---- 行内启停（乐观更新，失败回滚） ----

  const toggleEnabled = useCallback(
    (rule: SmartSortRule, next: boolean) => {
      setRows(prev =>
        prev.map(r => (r.ruleId === rule.ruleId ? {...r, enabled: next} : r)),
      );
      runtime.smartSortRule
        .setEnabled(rule.ruleId, next)
        .catch(error => {
          setRows(prev =>
            prev.map(r =>
              r.ruleId === rule.ruleId ? {...r, enabled: rule.enabled} : r,
            ),
          );
          showToast(toastMessage('操作失败', error));
        });
    },
    [runtime, setRows, showToast],
  );

  // ---- 批量 ----

  const confirmBatchDelete = useBatchDeleteConfirm<string>({
    title: '删除规则',
    message: ids => `确定删除选中的 ${ids.length} 条规则？`,
    deleteOne: useCallback(
      async (ruleId: string) => {
        // builtin- 由 service 整体拒绝；这里逐条走 deleteRule 保持部分成功语义。
        await runtime.smartSortRule.deleteRule(ruleId);
      },
      [runtime],
    ),
    onDone: async () => {
      batch.exit();
      await reload();
    },
  });

  const runBatchDelete = useCallback(() => {
    const ids = Array.from(batch.selectedIds);
    if (ids.some(id => isBuiltinSmartSortRuleId(id))) {
      showToast('内置规则不可删除，请取消勾选后再删除');
      return;
    }
    confirmBatchDelete(ids);
  }, [batch.selectedIds, confirmBatchDelete, showToast]);

  const runBatchSetEnabled = useCallback(
    (enabled: boolean) => {
      const ids = Array.from(batch.selectedIds);
      if (ids.length === 0) {
        return;
      }
      runtime.smartSortRule
        .setEnabledBatch(ids, enabled)
        .then(async () => {
          await reload({silent: true});
        })
        .catch(error => {
          showToast(toastMessage('操作失败', error));
        });
    },
    [batch.selectedIds, runtime, reload, showToast],
  );

  // ---- YAML 导入导出 / 恢复默认 ----

  const handleMoreSelect = useCallback(
    (action: string) => {
      setMoreMenuVisible(false);
      switch (action) {
        case 'import':
          Alert.alert(
            '导入规则',
            '导入将替换全部现有规则（含内置规则的启停状态），确定继续？',
            [
              {text: '取消', style: 'cancel'},
              {
                text: '导入',
                onPress: () => {
                  importSmartSortRuleYaml(runtime)
                    .then(async count => {
                      if (count == null) {
                        return;
                      }
                      await reload({silent: true});
                      showToast(`已导入 ${count} 条规则`);
                    })
                    .catch(error =>
                      showToast(toastMessage('导入失败', error)),
                    );
                },
              },
            ],
          );
          break;
        case 'export':
          exportSmartSortRuleYaml(runtime)
            .then(result => {
              if (result === 'saved') {
                showToast('已导出规则');
              }
            })
            .catch(error => showToast(toastMessage('导出失败', error)));
          break;
        case 'reset':
          Alert.alert(
            '恢复默认',
            '将重灌全部内置规则（含删除后重建、恢复启用），用户自建规则不受影响。',
            [
              {text: '取消', style: 'cancel'},
              {
                text: '恢复',
                onPress: () => {
                  runtime.smartSortRule
                    .resetDefaults()
                    .then(async () => {
                      await reload({silent: true});
                      showToast('已恢复默认规则');
                    })
                    .catch(error =>
                      showToast(toastMessage('恢复失败', error)),
                    );
                },
              },
            ],
          );
          break;
        default:
          break;
      }
    },
    [runtime, reload, showToast],
  );

  const rowMenuItems = menuRule
    ? [
        {label: '编辑', action: 'edit'},
        {label: '置顶', action: 'top'},
        {label: '上移', action: 'up'},
        {label: '下移', action: 'down'},
        {label: '置底', action: 'bottom'},
        // 内置规则仅可禁用不可删除（spec D3）。
        ...(isBuiltinSmartSortRuleId(menuRule.ruleId)
          ? []
          : [{label: '删除', action: 'delete', danger: true}]),
      ]
    : [];

  return (
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="智能排序规则"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={runBatchDelete}
        onSelectAll={
          rows.length > 0
            ? () => batch.selectRange(rows.map(r => r.ruleId))
            : undefined
        }
        allSelected={
          rows.length > 0 && batch.selectedCount === rows.length
        }
        actions={[
          {label: '启用', onPress: () => runBatchSetEnabled(true)},
          {label: '禁用', onPress: () => runBatchSetEnabled(false)},
        ]}
        hint="选择要操作的规则；内置规则不可删除"
        normalActions={
          <View style={styles.headerActions}>
            <SecondaryButton
              label="更多"
              tokens={tokens}
              onPress={() => setMoreMenuVisible(true)}
            />
            <PrimaryButton label="新建" tokens={tokens} onPress={createRule} />
          </View>
        }
      />
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={listScreenStyles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.ruleId}
          contentContainerStyle={listScreenStyles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void reload()}
            />
          }
          ListEmptyComponent={
            <Text
              style={[listScreenStyles.empty, {color: tokens.textSecondary}]}
            >
              暂无规则，点击「新建」创建。
            </Text>
          }
          renderItem={({item}) => (
            <ConfigListCard
              tokens={tokens}
              selected={batch.isSelected(item.ruleId)}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.ruleId);
                } else {
                  navigation.navigate('SmartSortRuleEditor', {
                    ruleId: item.ruleId,
                  });
                }
              }}
              leading={
                batch.active ? (
                  <BatchCheckbox
                    checked={batch.isSelected(item.ruleId)}
                    onToggle={() => batch.toggle(item.ruleId)}
                  />
                ) : (
                  <Switch
                    value={item.enabled}
                    onValueChange={next => toggleEnabled(item, next)}
                    trackColor={{false: tokens.border, true: tokens.primary}}
                  />
                )
              }
              title={item.name}
              subtitle={`${isBuiltinSmartSortRuleId(item.ruleId) ? '内置 · ' : ''}${
                item.description ?? '—'
              }`}
              onMenuPress={
                batch.active ? undefined : () => setMenuRule(item)
              }
              showChevron={!batch.active}
            />
          )}
        />
      )}
      <BottomSheetMenu
        visible={menuRule != null}
        title={menuRule?.name}
        items={rowMenuItems}
        onSelect={handleRowMenuSelect}
        onClose={() => setMenuRule(null)}
      />
      <BottomSheetMenu
        visible={moreMenuVisible}
        title="规则库"
        items={[
          {label: '导入 YAML', action: 'import'},
          {label: '导出 YAML', action: 'export'},
          {label: '恢复默认', action: 'reset'},
        ]}
        onSelect={handleMoreSelect}
        onClose={() => setMoreMenuVisible(false)}
      />
    </View>
  );
}

const EMPTY_RULES: SmartSortRule[] = [];

const styles = StyleSheet.create({
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: 8},
});
