/**
 * 列表单选弹窗骨架（cr-fix-spec comp-rest/C-5）：底部 sheet + visible 触发
 * load 拉行数据 + loading / 错误重试 / 空态 + 行选择回抛。
 *
 * 错误态保留 b2/B-1 拍板的语义：load 失败渲染错误文案与「重试」，不吞错
 * 伪装成空列表。AgentPickerModal / ModelPickerModal / SkillPicker 只做数据适配。
 */
import React, {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {formatError} from '../../errors/format-error';
import {useTheme} from '../../theme/ThemeProvider';
import {ModalShell} from './ModalShell';

export type PickerListLoadResult<T> = {
  rows: T[];
  selectedId?: string;
};

export type PickerRowProps = {
  testID?: string;
  accessibilityLabel?: string;
  /** 行常态透明度（如已关闭技能 0.55）；按压淡化优先于它。 */
  opacity?: number;
};

type Props<T> = {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** 每次打开时拉取行数据与当前选中 id。 */
  load: () => Promise<PickerListLoadResult<T>>;
  keyExtractor: (item: T) => string;
  /** 选中判定，默认 keyExtractor(item) === selectedId。 */
  isSelected?: (item: T, index: number, selectedId: string | undefined) => boolean;
  /** 行内容（不含行容器与按压反馈）。 */
  renderRow: (item: T, selected: boolean) => ReactNode;
  onPick: (item: T) => void;
  emptyText: string;
  onClose: () => void;
  /** 行级 testID / accessibilityLabel / 透明度。 */
  getRowProps?: (item: T) => PickerRowProps;
};

export function PickerListModal<T>({
  visible,
  title,
  subtitle,
  load,
  keyExtractor,
  isSelected,
  renderRow,
  onPick,
  emptyText,
  onClose,
  getRowProps,
}: Props<T>) {
  const {tokens} = useTheme();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await load();
      setRows(result.rows);
      setSelectedId(result.selectedId);
    } catch (cause) {
      setRows([]);
      setError(formatError(cause));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (visible) {
      reload().catch(() => undefined);
    }
  }, [visible, reload]);

  const isRowSelected = useCallback(
    (item: T, index: number) =>
      isSelected != null
        ? isSelected(item, index, selectedId)
        : keyExtractor(item) === selectedId,
    [isSelected, keyExtractor, selectedId],
  );

  return (
    <ModalShell
      visible={visible}
      onClose={onClose}
      variant="bottom"
      animationType="slide"
      panelStyle={styles.sheet}>
      <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
      {subtitle != null ? (
        <Text style={[styles.subtitle, {color: tokens.textSecondary}]}>
          {subtitle}
        </Text>
      ) : null}
      {loading ? (
        <ActivityIndicator style={styles.loader} />
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, {color: tokens.danger}]}>{error}</Text>
          <Pressable onPress={() => reload().catch(() => undefined)}>
            <Text style={{color: tokens.primary, fontWeight: '600'}}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          style={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              {emptyText}
            </Text>
          }
          renderItem={({item, index}) => {
            const selected = isRowSelected(item, index);
            const rowProps = getRowProps?.(item);
            return (
              <Pressable
                style={({pressed}) => [
                  styles.row,
                  {borderBottomColor: tokens.border},
                  selected && {backgroundColor: tokens.background},
                  {opacity: pressed ? 0.85 : (rowProps?.opacity ?? 1)},
                ]}
                onPress={() => onPick(item)}
                testID={rowProps?.testID}
                accessibilityLabel={rowProps?.accessibilityLabel}>
                {renderRow(item, selected)}
              </Pressable>
            );
          }}
        />
      )}
      <Pressable onPress={onClose} style={styles.cancelBtn}>
        <Text style={{color: tokens.textSecondary}}>取消</Text>
      </Pressable>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  loader: {marginVertical: 24},
  center: {alignItems: 'center', gap: 12, padding: 24},
  error: {textAlign: 'center', lineHeight: 20},
  empty: {textAlign: 'center', padding: 24},
  list: {flexShrink: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cancelBtn: {alignItems: 'center', paddingTop: 12},
});
