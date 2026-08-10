/**
 * Directory inclusion rule form → {@link WorkplaceService.setDirRule}.
 */
import React, { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  DEFAULT_WORKPLACE_DIR_RULE,
  type FillPolicy,
  type SetDirRuleInput,
  type SortField,
  type SortOrder,
} from '@novel-master/core/workplace';
import { FormSwitchRow } from '../form/FormSwitchRow';
import { AppModal } from '../ui/AppModal';
import { normalizeFillPolicyForMobile } from '../../storage/fill-policy-mobile';
import { useTheme } from '../../theme/ThemeProvider';
import { useAndroidModalKeyboardAvoid } from '../../hooks/useAndroidModalKeyboardAvoid';

type Props = {
  visible: boolean;
  logicalPath: string;
  initial?: Partial<SetDirRuleInput>;
  /** When true, rule must stay enabled (scope root). */
  rootRuleLocked?: boolean;
  onClose: () => void;
  onSave: (input: SetDirRuleInput) => Promise<void>;
};

const SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'name', label: '文件名称' },
  { value: 'created', label: '创建时间' },
  { value: 'updated', label: '更新时间' },
];

const SORT_ORDERS: { value: SortOrder; label: string }[] = [
  { value: 'asc', label: '升序' },
  { value: 'desc', label: '降序' },
];

const FILL_POLICIES: { value: FillPolicy; label: string }[] = [
  { value: 'filename', label: '文件名' },
  { value: 'header', label: '头信息' },
  { value: 'hidden', label: '不展示' },
];

export function DirectoryRuleSheet({
  visible,
  logicalPath,
  initial,
  rootRuleLocked = false,
  onClose,
  onSave,
}: Props) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  // 底部对齐 sheet：键盘弹起后面板紧贴屏幕底部，只移一半还是会被盖住，
  // 得移整个键盘高度才能贴到键盘上方。
  const panelAvoidStyle = useAndroidModalKeyboardAvoid(1);
  const [sortField, setSortField] = useState<SortField>(
    DEFAULT_WORKPLACE_DIR_RULE.sortField,
  );
  const [sortOrder, setSortOrder] = useState<SortOrder>(
    DEFAULT_WORKPLACE_DIR_RULE.sortOrder,
  );
  const [headCount, setHeadCount] = useState(
    String(DEFAULT_WORKPLACE_DIR_RULE.headCount),
  );
  const [tailCount, setTailCount] = useState(
    String(DEFAULT_WORKPLACE_DIR_RULE.tailCount),
  );
  const [fillPolicy, setFillPolicy] = useState<FillPolicy>(
    DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
  );
  const [ruleEnabled, setRuleEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setSortField(initial?.sortField ?? DEFAULT_WORKPLACE_DIR_RULE.sortField);
    setSortOrder(initial?.sortOrder ?? DEFAULT_WORKPLACE_DIR_RULE.sortOrder);
    setHeadCount(
      String(initial?.headCount ?? DEFAULT_WORKPLACE_DIR_RULE.headCount),
    );
    setTailCount(
      String(initial?.tailCount ?? DEFAULT_WORKPLACE_DIR_RULE.tailCount),
    );
    setFillPolicy(
      normalizeFillPolicyForMobile(
        initial?.fillPolicy ?? DEFAULT_WORKPLACE_DIR_RULE.fillPolicy,
      ),
    );
    setRuleEnabled(rootRuleLocked ? true : initial?.ruleEnabled ?? false);
  }, [visible, initial, logicalPath, rootRuleLocked]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        logicalPath,
        sortField,
        sortOrder,
        headCount: clampCount(headCount),
        tailCount: clampCount(tailCount),
        fillPolicy: normalizeFillPolicyForMobile(fillPolicy),
        ruleEnabled: rootRuleLocked ? true : ruleEnabled,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const sheetContent = (
    <View style={styles.backdrop}>
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: tokens.surface,
            paddingBottom: Math.max(insets.bottom, 16),
          },
          Platform.OS === 'android' ? panelAvoidStyle : undefined,
        ]}>
        <Text style={[styles.heading, { color: tokens.text }]}>目录规则</Text>
        <ScrollView
          style={styles.form}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <FormSwitchRow
            label="规则启用"
            tokens={tokens}
            value={ruleEnabled}
            onValueChange={setRuleEnabled}
            disabled={rootRuleLocked}
            description={rootRuleLocked ? '根目录规则不可关闭' : undefined}
            testID="dir-rule-enabled-switch"
          />
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
              { borderColor: tokens.border, color: tokens.text },
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
              { borderColor: tokens.border, color: tokens.text },
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
        <View style={[styles.actions, { borderTopColor: tokens.border }]}>
          <Pressable onPress={onClose} style={styles.actionBtn}>
            <Text style={{ color: tokens.textSecondary }}>取消</Text>
          </Pressable>
          <Pressable
            onPress={() => handleSave().catch(() => undefined)}
            disabled={saving}
            style={styles.actionBtn}>
            <Text style={{ color: tokens.primary }}>
              {saving ? '保存中…' : '保存'}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );

  return (
    <AppModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.avoidingRoot}>
          {sheetContent}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.avoidingRoot}>{sheetContent}</View>
      )}
    </AppModal>
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
  tokens: { textSecondary: string };
}) {
  return (
    <Text style={[styles.label, { color: tokens.textSecondary }]}>{text}</Text>
  );
}

function OptionRow<T extends string>({
  options,
  value,
  onChange,
  tokens,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  tokens: { border: string; primary: string; text: string };
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
            ]}
          >
            <Text style={{ color: active ? tokens.primary : tokens.text }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // 背景色放在 avoidingRoot：键盘弹起后底部不会透出白条，backdrop 不再单独设背景色。
  avoidingRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    overflow: 'hidden',
  },
  heading: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  form: { maxHeight: 360 },
  label: { fontSize: 12, marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  actionBtn: { padding: 8 },
});
