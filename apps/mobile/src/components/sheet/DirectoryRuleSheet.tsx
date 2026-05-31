/**
 * Directory inclusion rule form → {@link WorktreeService.setDirRule}.
 */
import React, {useEffect, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {
  FillPolicy,
  SetDirRuleInput,
  SortField,
  SortOrder,
} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  logicalPath: string;
  initial?: Partial<SetDirRuleInput>;
  onClose: () => void;
  onSave: (input: SetDirRuleInput) => Promise<void>;
};

const SORT_FIELDS: {value: SortField; label: string}[] = [
  {value: 'name', label: '文件名称'},
  {value: 'created', label: '创建时间'},
  {value: 'updated', label: '更新时间'},
];

const SORT_ORDERS: {value: SortOrder; label: string}[] = [
  {value: 'asc', label: '升序'},
  {value: 'desc', label: '降序'},
];

const FILL_POLICIES: {value: FillPolicy; label: string}[] = [
  {value: 'full', label: '全文本'},
  {value: 'filename', label: '文件名'},
  {value: 'header', label: '头信息'},
  {value: 'hidden', label: '不展示'},
];

export function DirectoryRuleSheet({
  visible,
  logicalPath,
  initial,
  onClose,
  onSave,
}: Props) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [headCount, setHeadCount] = useState('0');
  const [tailCount, setTailCount] = useState('0');
  const [fillPolicy, setFillPolicy] = useState<FillPolicy>('hidden');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setSortField(initial?.sortField ?? 'name');
    setSortOrder(initial?.sortOrder ?? 'asc');
    setHeadCount(String(initial?.headCount ?? 0));
    setTailCount(String(initial?.tailCount ?? 0));
    setFillPolicy(initial?.fillPolicy ?? 'hidden');
  }, [visible, initial, logicalPath]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        logicalPath,
        sortField,
        sortOrder,
        headCount: clampCount(headCount),
        tailCount: clampCount(tailCount),
        fillPolicy,
        ruleEnabled: true,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: tokens.surface,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}>
          <Text style={[styles.heading, {color: tokens.text}]}>
            目录规则
          </Text>
          <Text style={[styles.path, {color: tokens.textSecondary}]}>
            {logicalPath}
          </Text>
          <ScrollView
            style={styles.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <FieldLabel tokens={tokens} text="排序字段" />
            <OptionRow
              options={SORT_FIELDS}
              value={sortField}
              onChange={setSortField}
              tokens={tokens}
            />
            <FieldLabel tokens={tokens} text="排序方向" />
            <OptionRow
              options={SORT_ORDERS}
              value={sortOrder}
              onChange={setSortOrder}
              tokens={tokens}
            />
            <FieldLabel tokens={tokens} text="头部数量 (0–1000)" />
            <TextInput
              style={[
                styles.input,
                {borderColor: tokens.border, color: tokens.text},
              ]}
              keyboardType="number-pad"
              value={headCount}
              onChangeText={setHeadCount}
              underlineColorAndroid="transparent"
            />
            <FieldLabel tokens={tokens} text="尾部数量 (0–1000)" />
            <TextInput
              style={[
                styles.input,
                {borderColor: tokens.border, color: tokens.text},
              ]}
              keyboardType="number-pad"
              value={tailCount}
              onChangeText={setTailCount}
              underlineColorAndroid="transparent"
            />
            <FieldLabel tokens={tokens} text="其余文件填充" />
            <OptionRow
              options={FILL_POLICIES}
              value={fillPolicy}
              onChange={setFillPolicy}
              tokens={tokens}
            />
          </ScrollView>
          <View style={[styles.actions, {borderTopColor: tokens.border}]}>
            <Pressable onPress={onClose} style={styles.actionBtn}>
              <Text style={{color: tokens.textSecondary}}>取消</Text>
            </Pressable>
            <Pressable
              onPress={() => handleSave().catch(() => undefined)}
              disabled={saving}
              style={styles.actionBtn}>
              <Text style={{color: tokens.primary}}>
                {saving ? '保存中…' : '保存'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function clampCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    return 0;
  }
  return Math.min(1000, Math.max(0, n));
}

function FieldLabel({
  text,
  tokens,
}: {
  text: string;
  tokens: {textSecondary: string};
}) {
  return (
    <Text style={[styles.label, {color: tokens.textSecondary}]}>{text}</Text>
  );
}

function OptionRow<T extends string>({
  options,
  value,
  onChange,
  tokens,
}: {
  options: {value: T; label: string}[];
  value: T;
  onChange: (v: T) => void;
  tokens: {border: string; primary: string; text: string};
}) {
  return (
    <View style={styles.optionRow}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.chip,
              {
                borderColor: active ? tokens.primary : tokens.border,
                backgroundColor: active ? `${tokens.primary}22` : 'transparent',
              },
            ]}>
            <Text style={{color: active ? tokens.primary : tokens.text}}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    overflow: 'hidden',
  },
  heading: {fontSize: 18, fontWeight: '600', marginBottom: 4},
  path: {fontSize: 12, marginBottom: 12},
  form: {maxHeight: 360},
  label: {fontSize: 12, marginTop: 12, marginBottom: 6},
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {padding: 8},
});
