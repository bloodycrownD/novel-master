/**
 * Rules list for one regex group with batch delete.
 */
import React, {useCallback, useState} from 'react';
import {ActivityIndicator, FlatList, RefreshControl, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import { type RegexGroup, type RegexRule } from "@novel-master/core/regex";
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {PrimaryButton} from '../../components/ui/Buttons';
import {useBatchDeleteConfirm} from '../../hooks/useBatchDeleteConfirm';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useFocusListReload} from '../../hooks/useFocusListReload';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {listScreenStyles} from '../shared/list-screen-styles';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type RulesRoute = RouteProp<RootStackParamList, 'RegexRules'>;

function ruleMeta(rule: RegexRule): string {
  const parts: string[] = [];
  if (!rule.enabled) {
    parts.push('已禁用');
  }
  if (rule.llmReplace != null) {
    parts.push('llm');
  }
  if (rule.displayReplace != null) {
    parts.push('display');
  }
  return parts.join(' · ') || '—';
}

export function RegexRulesScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RulesRoute>();
  const groupId = route.params?.groupId;
  const {setStackOverride} = useHeaderContext();
  const [group, setGroup] = useState<RegexGroup | undefined>();
  const batch = useBatchSelection();

  // rows/loading/reload + 聚焦重载走共用 hook；加载失败 toast（保持原语义）。
  const {rows, loading, reload} = useFocusListReload<RegexRule[]>({
    fetcher: useCallback(async () => {
      if (!groupId) {
        // 缺路由参数：空态兑底（fetcher 返回 null 由 hook 落到 fallbackValue）
        return null;
      }
      const g = await runtime.regexConfig.getGroup(groupId);
      setGroup(g);
      setStackOverride({
        title: g.displayName?.trim() || g.groupId,
      });
      const list = await runtime.regexConfig.listRules(groupId);
      return [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    }, [runtime, groupId, setStackOverride]),
    fallbackValue: EMPTY_RULES,
    onError: useCallback(
      (cause: unknown) => {
        showToast(toastMessage('加载失败', cause));
      },
      [showToast],
    ),
  });

  // 失焦时清掉栈顶标题覆盖（重载本身已交给 useFocusListReload）。
  useFocusEffect(
    useCallback(() => {
      return () => setStackOverride(undefined);
    }, [setStackOverride]),
  );

  const createRule = () => {
    if (!groupId) {
      return;
    }
    navigation.navigate('RegexRuleEditor', {groupId});
  };

  const confirmBatchDelete = useBatchDeleteConfirm<string>({
    title: '删除规则',
    message: ids => `确定删除选中的 ${ids.length} 条规则？`,
    deleteOne: useCallback(
      async (ruleId: string) => {
        if (!groupId) {
          return;
        }
        await runtime.regexConfig.deleteRule(groupId, ruleId);
      },
      [runtime, groupId],
    ),
    onDone: async () => {
      batch.exit();
      await reload();
    },
  });

  return (
    <View style={[listScreenStyles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="规则"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={() => confirmBatchDelete(Array.from(batch.selectedIds))}
        hint="选择要删除的规则"
        normalActions={
          <PrimaryButton label="添加" tokens={tokens} onPress={createRule} />
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
            <RefreshControl refreshing={loading} onRefresh={() => void reload()} />
          }
          ListEmptyComponent={
            <Text
              style={[listScreenStyles.empty, {color: tokens.textSecondary}]}>
              暂无规则，点击「添加」创建。
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
                  navigation.navigate('RegexRuleEditor', {
                    groupId: groupId!,
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
                ) : undefined
              }
              title={item.name}
              subtitle={`${item.ruleId} · ${ruleMeta(item)}`}
              showChevron={!batch.active}
            />
          )}
        />
      )}
      {!group && !loading ? (
        <Text style={[listScreenStyles.empty, {color: tokens.textSecondary}]}>
          缺少 groupId
        </Text>
      ) : null}
    </View>
  );
}

const EMPTY_RULES: RegexRule[] = [];
