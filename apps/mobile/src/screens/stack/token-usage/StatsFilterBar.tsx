import React from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {AppModal} from '../../../components/ui/AppModal';
import {SegmentedControl} from '../../../components/ui/SegmentedControl';
import {MonthRangePickerSheet} from '../../../components/ui/MonthRangePickerSheet';
import type {ThemeTokens} from '../../../theme/tokens';
import {
  MODEL_OPTION_ALL,
  MODEL_OPTION_UNLOGGED,
  MODEL_OTHER_KEY,
  type ProviderModelFilterValue,
  type ProviderModelOption,
  type RangeKind,
  providerModelFilterOptionKey,
  providerModelKey,
} from './format';
import {styles} from './styles';

/** 弹层选项：id 为稳定键（testID/选中比对），value 为选中后回传的筛选值。 */
type ModelPickerOption = {
  readonly id: string;
  readonly label: string;
  readonly value: ProviderModelFilterValue;
};

/**
 * 筛选栏（screens/C-4 拆分自主文件）：时间范围 SegmentedControl +
 * 模型筛选入口 + 自定义区间 MonthRangePickerSheet + 模型选择弹层。
 * 筛选状态全部由父层持有传入——切页签不重查、筛选跨页签保留的
 * 语义由父层 state 保证，本组件只做展示与回调。
 */
export function StatsFilterBar({
  rangeKind,
  onRangeKindChange,
  modelFilterLabel,
  comboFilter,
  combos,
  providers,
  onSelectComboFilter,
  rangeSheetVisible,
  onCloseRangeSheet,
  onConfirmRange,
  modelPickerVisible,
  onOpenModelPicker,
  onCloseModelPicker,
  tokens,
}: {
  rangeKind: RangeKind;
  onRangeKindChange: (value: RangeKind) => void;
  modelFilterLabel: string;
  /** 当前筛选值：undefined = 全部、对象 = 配置组合 / 服务商其他模型 / 未记录服务商（三形态口径见 ProviderModelFilterValue）。 */
  comboFilter: ProviderModelFilterValue;
  combos: ProviderModelOption[];
  /** 全量服务商（含未配置模型者，按展示名排序）：生成每服务商「{服务商} · 其他模型」归并选项。 */
  providers: ReadonlyArray<{id: string; label: string}>;
  /** 选中筛选后回调（三态口径见 ProviderModelFilterValue）。 */
  onSelectComboFilter: (value: ProviderModelFilterValue) => void;
  rangeSheetVisible: boolean;
  onCloseRangeSheet: () => void;
  onConfirmRange: (from: Date, to: Date) => void;
  modelPickerVisible: boolean;
  onOpenModelPicker: () => void;
  onCloseModelPicker: () => void;
  tokens: ThemeTokens;
}) {
  // 选项集（CR-2 方案 A）：全部 / 配置组合「{服务商} · {模型}」/ 每服务商
  // 「{服务商} · 其他模型」（该服务商下不在配置集的模型行，含零配置服务商）/
  // 「未记录服务商（历史）」（provider_id IS NULL，模型在不在配置集均归此）
  // ——保证无筛选返回的每类 (providerId, modelName) 组合行都有选项可筛。
  const pickerOptions: readonly ModelPickerOption[] = [
    {id: MODEL_OPTION_ALL, label: '全部模型', value: undefined},
    ...combos.map(c => ({
      id: providerModelKey(c.providerId, c.model),
      label: `${c.providerLabel} · ${c.model}`,
      value: {providerId: c.providerId, model: c.model},
    })),
    ...providers.map(p => ({
      id: providerModelKey(p.id, MODEL_OTHER_KEY),
      label: `${p.label} · 其他模型`,
      value: {providerId: p.id, model: null},
    })),
    {
      id: MODEL_OPTION_UNLOGGED,
      label: '未记录服务商（历史）',
      value: {providerId: null, model: undefined},
    },
  ];
  return (
    <>
      <SegmentedControl
        options={[
          {
            value: 'last7' as RangeKind,
            label: '近 7 天',
            testID: 'range-last7',
          },
          {
            value: 'last30' as RangeKind,
            label: '近 30 天',
            testID: 'range-last30',
          },
          {
            value: 'custom' as RangeKind,
            label: '自定义',
            testID: 'range-custom',
          },
        ]}
        value={rangeKind}
        onChange={onRangeKindChange}
        tokens={tokens}
      />
      <Pressable
        testID="model-filter-entry"
        onPress={onOpenModelPicker}
        style={[
          styles.modelFilterRow,
          {
            backgroundColor: tokens.surface,
            borderColor: tokens.borderLight,
          },
        ]}
      >
        <Text style={{color: tokens.text}}>{modelFilterLabel}</Text>
        <Text style={{color: tokens.textSecondary}}>切换 ›</Text>
      </Pressable>
      <MonthRangePickerSheet
        visible={rangeSheetVisible}
        onClose={onCloseRangeSheet}
        onConfirm={onConfirmRange}
        tokens={tokens}
      />
      <AppModal
        visible={modelPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={onCloseModelPicker}
      >
        <Pressable style={styles.backdrop} onPress={onCloseModelPicker}>
          <Pressable
            style={[styles.pickerSheet, {backgroundColor: tokens.surface}]}
            onPress={e => e.stopPropagation()}
          >
            <Text style={[styles.pickerTitle, {color: tokens.text}]}>
              选择模型
            </Text>
            {/* 模型列表可很长：必须包滚动容器，否则被 pickerSheet 的 maxHeight 裁剪、
                后面的模型滚不到也点不到。 */}
            <ScrollView
              style={styles.pickerList}
              contentContainerStyle={styles.pickerListContent}
              keyboardShouldPersistTaps="handled"
            >
              {pickerOptions.map(option => {
                const selected =
                  comboFilter !== undefined &&
                  option.id === providerModelFilterOptionKey(comboFilter);
                return (
                  <Pressable
                    key={option.id}
                    testID={`model-option-${option.id}`}
                    onPress={() => {
                      onSelectComboFilter(option.value);
                      onCloseModelPicker();
                    }}
                    style={[
                      styles.pickerRow,
                      {borderBottomColor: tokens.border},
                      selected && {backgroundColor: tokens.bgSecondary},
                    ]}
                  >
                    <Text style={{color: tokens.text}} numberOfLines={1}>
                      {option.label}
                    </Text>
                    {selected ? (
                      <Text style={{color: tokens.primary}}>当前</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </AppModal>
    </>
  );
}
