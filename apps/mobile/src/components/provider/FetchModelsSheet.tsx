/**
 * Pull remote model list for a provider and save selected models.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useRuntime} from '../../hooks/useRuntime';
import {formatError} from '../../errors/format-error';
import {AppModal} from '../ui/AppModal';
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

  const addedSet = useMemo(() => new Set(addedIds), [addedIds]);

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

  return (
    <AppModal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
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
            <FlatList
              data={rows}
              keyExtractor={item => item.vendorModelId}
              style={styles.list}
              ListEmptyComponent={
                <Text style={[styles.empty, {color: tokens.textSecondary}]}>
                  未拉取到可用模型，请检查 API Key 与 Base URL。
                </Text>
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
          )}
          <Pressable onPress={onClose} style={styles.doneBtn}>
            <Text style={{color: tokens.textSecondary}}>完成</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
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
  list: {maxHeight: 420},
  empty: {textAlign: 'center', padding: 24},
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
