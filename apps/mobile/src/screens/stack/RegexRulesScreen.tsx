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
import type {RegexGroup, RegexRule} from '@novel-master/core';
import {BatchCheckbox} from '../../components/batch/BatchCheckbox';
import {ManageHeader} from '../../components/batch/ManageHeader';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

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
      Alert.alert(
        '加载失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoading(false);
    }
  }, [runtime, groupId, setStackOverride]);

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
            Alert.alert('已删除规则');
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
          <Pressable
            style={[styles.addBtn, {backgroundColor: tokens.primary}]}
            onPress={createRule}>
            <Text style={styles.addBtnText}>添加</Text>
          </Pressable>
        }
      />
      {loading && rules.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rules}
          keyExtractor={item => item.ruleId}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无规则，点击「添加」创建。
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={[styles.row, {borderBottomColor: tokens.border}]}
              onPress={() => {
                if (batch.active) {
                  batch.toggle(item.ruleId);
                } else {
                  navigation.navigate('RegexRuleEditor', {
                    groupId: groupId!,
                    ruleId: item.ruleId,
                  });
                }
              }}>
              {batch.active ? (
                <BatchCheckbox
                  checked={batch.isSelected(item.ruleId)}
                  onToggle={() => batch.toggle(item.ruleId)}
                />
              ) : null}
              <View style={styles.info}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.name}
                </Text>
                <Text style={[styles.meta, {color: tokens.textSecondary}]}>
                  {item.ruleId} · {ruleMeta(item)}
                </Text>
              </View>
              {!batch.active ? (
                <Text style={{color: tokens.textSecondary}}>›</Text>
              ) : null}
            </Pressable>
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
  addBtn: {paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8},
  addBtnText: {color: '#fff', fontWeight: '600'},
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
});
