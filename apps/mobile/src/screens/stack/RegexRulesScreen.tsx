/**
 * Rules list for one regex group.
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

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <View style={[styles.toolbar, {borderBottomColor: tokens.border}]}>
        <Pressable
          style={[styles.addBtn, {backgroundColor: tokens.primary}]}
          onPress={createRule}>
          <Text style={styles.addBtnText}>添加规则</Text>
        </Pressable>
      </View>
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
              暂无规则，点击「添加规则」。
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={[styles.row, {borderBottomColor: tokens.border}]}
              onPress={() =>
                navigation.navigate('RegexRuleEditor', {
                  groupId: groupId!,
                  ruleId: item.ruleId,
                })
              }>
              <View style={styles.info}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.name}
                </Text>
                <Text style={[styles.meta, {color: tokens.textSecondary}]}>
                  {item.ruleId} · {ruleMeta(item)}
                </Text>
              </View>
              <Text style={{color: tokens.textSecondary}}>›</Text>
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
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
