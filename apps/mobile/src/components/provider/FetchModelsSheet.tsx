/**
 * Pull remote model list for a provider and save selected models.
 * 勾选 + 批量添加，支持过滤后全选。
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
import {ModalShell} from '../ui/ModalShell';
import {FormTextInput} from '../form/FormTextInput';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {useBatchSelection} from '../../hooks/useBatchSelection';
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
  const batch = useBatchSelection();
  const [rows, setRows] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  // load 失败（拉取异常）会替换列表为错误+重试；保存失败只挂在底部一条文案，
  // 列表与勾选保留，方便重试。
  const [error, setError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');

  const addedSet = useMemo(() => new Set(addedIds), [addedIds]);

  // 过滤只作用展示层：addedIds 不随过滤词变化。
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

  // 当前过滤结果里还能勾选（未添加）的行：全选只作用于这一组。
  const selectableRows = useMemo(
    () => filteredRows.filter(item => !addedSet.has(item.vendorModelId)),
    [filteredRows, addedSet],
  );
  // 全量（未过滤）可选行：计数条展示基准。过滤后无可选行时计数仍需可见
  // （隐藏勾选无处清空），与 desktop FetchModelsModal 口径一致。
  const allSelectableCount = useMemo(
    () => rows.filter(item => !addedSet.has(item.vendorModelId)).length,
    [rows, addedSet],
  );

  const allSelected =
    selectableRows.length > 0 &&
    selectableRows.every(item => batch.isSelected(item.vendorModelId));

  const toggleSelectAll = useCallback(() => {
    batch.selectRange(
      allSelected ? [] : selectableRows.map(item => item.vendorModelId),
    );
  }, [batch, allSelected, selectableRows]);

  // 键盘避让（上移 + maxHeight 收缩）由 ModalShell 的 adaptive 策略统一处理。

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
      setSaveError(undefined);
      // batch.exit 为稳定引用（useCallback([])），不会引起 effect 重跑
      batch.exit();
      load().catch(() => undefined);
    }
  }, [visible, load, batch.exit]);

  // 逐个保存勾选的模型；任一失败即停止并展示错误，
  // 已成功的行标「已添加」，勾选清到只剩未保存的行（方便失败后重试）。
  const saveSelected = async () => {
    if (batch.selectedCount === 0 || saving) {
      return;
    }
    setSaving(true);
    setError(undefined);
    setSaveError(undefined);
    const selected = rows.filter(
      item =>
        batch.isSelected(item.vendorModelId) &&
        !addedSet.has(item.vendorModelId),
    );
    const savedNow: string[] = [];
    try {
      for (const item of selected) {
        try {
          await runtime.providerModels.save(
            providerId,
            item.vendorModelId,
            item.displayName ?? undefined,
          );
          savedNow.push(item.vendorModelId);
        } catch (cause) {
          setSaveError(formatError(cause));
          break;
        }
      }
    } finally {
      if (savedNow.length > 0) {
        setAddedIds(prev => {
          const next = new Set(prev);
          for (const id of savedNow) {
            next.add(id);
          }
          return next;
        });
        onSaved();
      }
      const savedNowSet = new Set(savedNow);
      batch.selectRange(
        selected
          .filter(item => !savedNowSet.has(item.vendorModelId))
          .map(item => item.vendorModelId),
      );
      setSaving(false);
    }
  };

  const confirmLabel =
    batch.selectedCount > 0 ? `添加 (${batch.selectedCount})` : '添加';

  const body = (
    <>
      <Text style={[styles.title, {color: tokens.text}]}>拉取模型</Text>
      <Text style={[styles.subtitle, {color: tokens.textSecondary}]}>
        从服务商获取可用模型，勾选后批量添加
      </Text>
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
          <Pressable onPress={() => load().catch(() => undefined)}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>重试</Text>
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
          {allSelectableCount > 0 ? (
            <View style={styles.selectBar}>
              {selectableRows.length > 0 ? (
                <Pressable
                  onPress={toggleSelectAll}
                  disabled={saving}
                  hitSlop={8}
                >
                  <Text style={{color: tokens.primary, fontWeight: '600'}}>
                    {allSelected ? '全不选' : '全选'}
                  </Text>
                </Pressable>
              ) : null}
              <Text style={{color: tokens.textSecondary, fontSize: 13}}>
                已选 {batch.selectedCount} 项
              </Text>
            </View>
          ) : null}
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
              const selected = batch.isSelected(item.vendorModelId);
              const label = item.displayName?.trim() || item.vendorModelId;
              return (
                <Pressable
                  style={[
                    styles.row,
                    {borderBottomColor: tokens.border},
                    selected && {backgroundColor: tokens.bgSecondary},
                    saved && {opacity: 0.55},
                  ]}
                  disabled={saved || saving}
                  onPress={() => batch.toggle(item.vendorModelId)}
                >
                  {saved ? (
                    // 与 BatchCheckbox 等宽占位，保持文本左对齐
                    <View style={styles.checkSpacer} />
                  ) : (
                    <BatchCheckbox
                      checked={selected}
                      onToggle={() => batch.toggle(item.vendorModelId)}
                    />
                  )}
                  <View style={styles.rowText}>
                    <Text style={{color: tokens.text, fontWeight: '500'}}>
                      {label}
                    </Text>
                    {item.displayName?.trim() &&
                    item.displayName.trim() !== item.vendorModelId ? (
                      <Text style={{color: tokens.textSecondary, fontSize: 13}}>
                        {item.vendorModelId}
                      </Text>
                    ) : null}
                  </View>
                  {saving && selected && !saved ? (
                    <ActivityIndicator size="small" />
                  ) : saved ? (
                    <Text style={{color: tokens.textSecondary}}>已添加</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        </>
      )}
      {saveError ? (
        <Text style={[styles.saveError, {color: tokens.danger}]}>
          {saveError}
        </Text>
      ) : null}
      <View style={styles.actionRow}>
        <Pressable onPress={onClose} disabled={saving} style={styles.doneBtn}>
          <Text style={{color: tokens.textSecondary}}>完成</Text>
        </Pressable>
        <Pressable
          onPress={() => saveSelected().catch(() => undefined)}
          disabled={batch.selectedCount === 0 || saving}
          style={({pressed}) => [
            styles.confirmBtn,
            {backgroundColor: tokens.primary},
            (batch.selectedCount === 0 || saving) && {opacity: 0.45},
            pressed && {opacity: 0.85},
          ]}
        >
          <Text style={styles.confirmText}>
            {saving ? '添加中…' : confirmLabel}
          </Text>
        </Pressable>
      </View>
    </>
  );

  return (
    <ModalShell
      visible={visible}
      onClose={onClose}
      variant="bottom"
      animationType="slide"
      keyboardAvoid={{kind: 'adaptive', maxHeightRatio: 0.75}}
      panelStyle={styles.sheet}
    >
      {body}
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  sheet: {
    // maxHeight（含键盘收缩）由 useAdaptiveKeyboardSheetStyle 管
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
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
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
  checkSpacer: {width: 18, height: 18, marginRight: 8},
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
  },
  saveError: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    paddingTop: 8,
  },
  doneBtn: {flex: 1, alignItems: 'center', paddingVertical: 10},
  confirmBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  confirmText: {color: '#fff', fontWeight: '600'},
});
