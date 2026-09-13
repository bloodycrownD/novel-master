/**
 * Directory inclusion rule form → {@link WorkplaceService.setDirRule}.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  DEFAULT_WORKPLACE_DIR_RULE,
  type FillPolicy,
  type SetDirRuleInput,
  type SortField,
  type SortOrder,
} from '@novel-master/core/workplace';
import {ModalShell} from '../ui/ModalShell';
import {
  PickerListModal,
  type PickerListLoadResult,
} from '../ui/PickerListModal';
import {normalizeFillPolicyForMobile} from '../../services/fill-policy-mobile';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  visible: boolean;
  logicalPath: string;
  initial?: Partial<SetDirRuleInput>;
  /** When true, rule must stay enabled (scope root). */
  rootRuleLocked?: boolean;
  onClose: () => void;
  onSave: (input: SetDirRuleInput) => Promise<void>;
};

// 4 项横排 chip 会换行把面板顶出滚动区，排序方式改 PickerListModal 单选
// （智能排序列表首项，照 ModelPickerModal 先例），表单内只留一行当前值。
const SORT_FIELDS: {value: SortField; label: string}[] = [
  {value: 'smart', label: '智能排序'},
  {value: 'name', label: '文件名称'},
  {value: 'created', label: '创建时间'},
  {value: 'updated', label: '更新时间'},
];

const SORT_ORDERS: {value: SortOrder; label: string}[] = [
  {value: 'asc', label: '升序'},
  {value: 'desc', label: '降序'},
];

const FILL_POLICIES: {value: FillPolicy; label: string}[] = [
  {value: 'filename', label: '文件名'},
  {value: 'header', label: '头信息'},
  {value: 'hidden', label: '不展示'},
];

export function DirectoryRuleSheet({
  visible,
  logicalPath,
  initial,
  rootRuleLocked = false,
  onClose,
  onSave,
}: Props) {
  const {tokens} = useTheme();
  const insets = useSafeAreaInsets();
  // 85% 高面板 + 两个数字输入：键盘避让不能只做位移（translate fraction=1
  // 会把标题顶出屏），由 ModalShell 的 adaptive 策略「上移 + maxHeight 收缩」
  // 处理，面板不超过屏幕剩余空间。
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
  const [sortFieldPickerVisible, setSortFieldPickerVisible] = useState(false);

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

  // PickerListModal 骨架要求 load 异步；静态选项每次打开以当前 sortField 高亮。
  const loadSortFields = useCallback(async (): Promise<
    PickerListLoadResult<{value: SortField; label: string}>
  > => ({rows: SORT_FIELDS, selectedId: sortField}), [sortField]);

  const sheetContent = (
    <>
      <Text style={[styles.heading, {color: tokens.text}]}>目录规则</Text>
      <ScrollView
        style={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 规则启用/关闭由文件管理的快捷开关负责，表单内不再提供开关，仅编辑规则内容；
              ruleEnabled 沿用打开时的既有状态原样保存。 */}
        <FieldLabel tokens={tokens} text="排序方式" />
        <Pressable
          testID="sort-field-value-row"
          accessibilityLabel="选择排序方式"
          onPress={() => setSortFieldPickerVisible(true)}
          style={[
            styles.pickerRow,
            {borderColor: tokens.border, backgroundColor: tokens.bgSecondary},
          ]}
        >
          <Text
            testID="sort-field-value"
            style={{color: tokens.text}}
            numberOfLines={1}>
            {(SORT_FIELDS.find(opt => opt.value === sortField) ?? SORT_FIELDS[0])
              .label}
          </Text>
          <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
        </Pressable>
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
          style={styles.actionBtn}
        >
          <Text style={{color: tokens.primary}}>
            {saving ? '保存中…' : '保存'}
          </Text>
        </Pressable>
      </View>
    </>
  );

  return (
    <>
      <ModalShell
        visible={visible}
        onClose={onClose}
        variant="bottom"
        animationType="slide"
        keyboardAvoid={{kind: 'adaptive', maxHeightRatio: 0.85}}
        panelStyle={[styles.sheet, {paddingBottom: Math.max(insets.bottom, 16)}]}
      >
        {sheetContent}
      </ModalShell>
      {/* 排序方式单选：独立底部弹层（RN Modal 叠 Modal），选中即关。 */}
      <PickerListModal
        visible={sortFieldPickerVisible}
        title="排序方式"
        load={loadSortFields}
        keyExtractor={item => item.value}
        renderRow={(item, selected) => (
          <>
            <Text style={{color: tokens.text}}>{item.label}</Text>
            {selected ? (
              <Text style={{color: tokens.primary}}>当前</Text>
            ) : null}
          </>
        )}
        getRowProps={item => ({
          testID: `sort-field-option-${item.value}`,
          accessibilityLabel: `排序方式 ${item.label}`,
        })}
        onPick={item => {
          setSortField(item.value);
          setSortFieldPickerVisible(false);
        }}
        emptyText="暂无可选排序方式"
        onClose={() => setSortFieldPickerVisible(false)}
      />
    </>
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
            ]}
          >
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
  sheet: {
    // maxHeight（含键盘收缩）由 useAdaptiveKeyboardSheetStyle 管
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    overflow: 'hidden',
  },
  heading: {fontSize: 18, fontWeight: '600', marginBottom: 12},
  // maxHeight 收缩时内容要向内收缩，否则底部按钮行被裁（对齐 ToolPolicyPicker list）
  form: {maxHeight: 360, flexShrink: 1},
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
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chevron: {fontSize: 18, lineHeight: 22},
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {padding: 8},
});
