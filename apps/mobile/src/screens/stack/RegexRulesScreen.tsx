/**
 * Rules list for one regex group with batch delete.
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
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import { type RegexGroup, type RegexRule } from "@novel-master/core/regex";
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {ConfigListCard} from '../../components/ui/ConfigListCard';
import {PrimaryButton} from '../../components/ui/PrototypeButtons';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
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
  const [rules, setRules] = useState<RegexRule[]>([]);
  const [loading, setLoading] = useState(true);
  const batch = useBatchSelection();

  const reload = useCallback(async () => {
    if (!groupId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const g = await runtime.regexConfig.getGroup(groupId);
      setGroup(g);
      setStackOverride({
        title: g.displayName?.trim() || g.groupId,
      });
      const list = await runtime.regexConfig.listRules(groupId);
      setRules(
        [...list].sort((a, b) => a.sortOrder - b.sortOrder),
      );
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, groupId, setStackOverride, showToast]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
      return () => setStackOverride(undefined);
    }, [reload, setStackOverride]),
  );

  const createRule = () => {
    if (!groupId) {
      return;
    }
    navigation.navigate('RegexRuleEditor', {groupId});
  };

  const confirmBatchDelete = () => {
    if (!groupId) {
      return;
    }
    const ids = Array.from(batch.selectedIds);
    if (ids.length === 0) {
      return;
    }
    Alert.alert('删除规则', `确定删除选中的 ${ids.length} 条规则？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            for (const ruleId of ids) {
              await runtime.regexConfig.deleteRule(groupId, ruleId);
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

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ManageHeader
        title="规则"
        batchMode={batch.active}
        selectedCount={batch.selectedCount}
        onEnterBatch={batch.enter}
        onCancelBatch={batch.exit}
        onDelete={confirmBatchDelete}
        hint="选择要删除的规则"
        normalActions={
          <PrimaryButton label="添加" tokens={tokens} onPress={createRule} />
        }
      />
      {loading && rules.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rules}
          keyExtractor={item => item.ruleId}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
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
        <Text style={[styles.empty, {color: tokens.textSecondary}]}>
          缺少 groupId
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  listContent: {paddingBottom: 24},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 32},
});
