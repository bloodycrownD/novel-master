/**
 * Pull remote model list for a provider and save selected models.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {useAnimatedStyle} from 'react-native-reanimated';
import {
  KeyboardAvoidingView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import {useRuntime} from '../../hooks/useRuntime';
import {formatError} from '../../errors/format-error';
import {AppModal} from '../ui/AppModal';
import {FormTextInput} from '../form/FormTextInput';
import {useTheme} from '../../theme/ThemeProvider';

type SuggestionRow = {
  vendorModelId: string;
  displayName: string | null;
};

type Props = {
  visible: boolean;
  providerId: string;
  onClose: () => void;
  onSaved: () => void;
};

export function FetchModelsSheet({
  visible,
  providerId,
  onClose,
  onSaved,
}: Props) {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const [rows, setRows] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [savingId, setSavingId] = useState<string | undefined>();
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');

  const addedSet = useMemo(() => new Set(addedIds), [addedIds]);

  // 过滤只作用展示层：addedIds / savingId 不随过滤词变化。
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') {
      return rows;
    }
    return rows.filter(
      item =>
        item.displayName?.trim().toLowerCase().includes(q) ||
        item.vendorModelId.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // 键盘避让：高面板（maxHeight 75%）不能只做位移——整体上移键盘高度后顶部（标题/过滤框）
  // 会被顶出屏幕（useAndroidModalKeyboardAvoid 的 fraction=1 只适合矮 sheet，如 AddModelModal）。
  // 这里在上移的同时让 maxHeight 随键盘收缩：面板高度不超过屏幕剩余空间，
  // 底部贴键盘顶（Android translateY / iOS KeyboardAvoidingView padding）且顶部不出屏。
  const {height: keyboardHeightSV} = useReanimatedKeyboardAnimation();
  const {height: screenH} = useWindowDimensions();
  const panelAvoidStyle = useAnimatedStyle(() => {
    const kb = Math.min(0, keyboardHeightSV.value);
    const available = screenH + kb - 24; // 顶部留 24px 余量
    return {
      ...(Platform.OS === 'android' ? {transform: [{translateY: kb}]} : {}),
      maxHeight: Math.max(160, Math.min(screenH * 0.75, available)),
    };
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      await runtime.providerModels.fetch(providerId);
      const suggestions = await runtime.providerModels.suggestList(providerId);
      setRows(suggestions.filter(s => !s.stale));
    } catch (cause) {
      setRows([]);
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }, [runtime, providerId]);

  useEffect(() => {
    if (visible) {
      setAddedIds(new Set());
      setQuery('');
      load().catch(() => undefined);
    }
  }, [visible, load]);

  const saveModel = async (suggestion: SuggestionRow) => {
    if (addedSet.has(suggestion.vendorModelId) || savingId) {
      return;
    }
    setSavingId(suggestion.vendorModelId);
    try {
      await runtime.providerModels.save(
        providerId,
        suggestion.vendorModelId,
        suggestion.displayName ?? undefined,
      );
      setAddedIds(prev => new Set(prev).add(suggestion.vendorModelId));
      onSaved();
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setSavingId(undefined);
    }
  };

  const body = (
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Animated.View
        style={[
          styles.sheet,
          {backgroundColor: tokens.surface},
          panelAvoidStyle,
        ]}
        onStartShouldSetResponder={() => true}>
        <Text style={[styles.title, {color: tokens.text}]}>拉取模型</Text>
        <Text style={[styles.subtitle, {color: tokens.textSecondary}]}>
          从服务商获取可用模型，点击即可保存
        </Text>
        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : error ? (
          <View style={styles.center}>
            <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
            <Pressable onPress={() => load().catch(() => undefined)}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                重试
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.searchWrap}>
              <FormTextInput
                tokens={tokens}
                value={query}
                onChangeText={setQuery}
                placeholder="过滤模型…"
              />
            </View>
            {/* key 技巧：过滤词变化时重建 FlatList，滚动位置归零 */}
            <FlatList
              data={filteredRows}
              key={query}
              keyExtractor={item => item.vendorModelId}
              style={styles.list}
              ListEmptyComponent={
                rows.length === 0 ? (
                  <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                    未拉取到可用模型，请检查 API Key 与 Base URL。
                  </Text>
                ) : (
                  <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                    无匹配模型
                  </Text>
                )
              }
              renderItem={({item}) => {
                const saved = addedSet.has(item.vendorModelId);
                const saving = savingId === item.vendorModelId;
                const label = item.displayName?.trim() || item.vendorModelId;
                return (
                  <Pressable
                    style={[
                      styles.row,
                      {borderBottomColor: tokens.border},
                      saved && {opacity: 0.55},
                    ]}
                    disabled={saved || saving}
                    onPress={() => saveModel(item).catch(() => undefined)}>
                    <View style={styles.rowText}>
                      <Text style={{color: tokens.text, fontWeight: '500'}}>
                        {label}
                      </Text>
                      {item.displayName?.trim() &&
                      item.displayName.trim() !== item.vendorModelId ? (
                        <Text
                          style={{color: tokens.textSecondary, fontSize: 13}}>
                          {item.vendorModelId}
                        </Text>
                      ) : null}
                    </View>
                    {saving ? (
                      <ActivityIndicator size="small" />
                    ) : saved ? (
                      <Text style={{color: tokens.textSecondary}}>已添加</Text>
                    ) : (
                      <Text style={{color: tokens.primary, fontWeight: '600'}}>
                        添加
                      </Text>
                    )}
                  </Pressable>
                );
              }}
            />
          </>
        )}
        <Pressable onPress={onClose} style={styles.doneBtn}>
          <Text style={{color: tokens.textSecondary}}>完成</Text>
        </Pressable>
      </Animated.View>
    </Pressable>
  );

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView behavior="padding" style={styles.avoidingRoot}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.avoidingRoot}>{body}</View>
      )}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  // 背景色放在 avoidingRoot：KeyboardAvoidingView 加的 paddingBottom 区域
  // 也属于 avoidingRoot 的 padding box，会被 backgroundColor 覆盖，
  // 这样键盘弹起后底部不会透出白条。backdrop 不再单独设背景色。
  avoidingRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  loader: {marginVertical: 32},
  center: {alignItems: 'center', gap: 12, padding: 24},
  error: {textAlign: 'center', lineHeight: 20},
  list: {maxHeight: 420, flexShrink: 1},
  empty: {textAlign: 'center', padding: 24},
  searchWrap: {paddingHorizontal: 16, paddingBottom: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowText: {flex: 1, gap: 2},
  doneBtn: {alignItems: 'center', paddingTop: 12},
});
