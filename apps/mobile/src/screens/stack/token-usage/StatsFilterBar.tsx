import React from 'react';
import {Pressable, Text, View} from 'react-native';
import {AppModal} from '../../../components/ui/AppModal';
import {SegmentedControl} from '../../../components/ui/SegmentedControl';
import {MonthRangePickerSheet} from '../../../components/ui/MonthRangePickerSheet';
import type {ThemeTokens} from '../../../theme/tokens';
import {
  MODEL_OPTION_ALL,
  MODEL_OPTION_UNLOGGED,
  type RangeKind,
} from './format';
import {styles} from './styles';

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
  modelFilter,
  models,
  onSelectModelFilter,
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
  /** 当前模型筛选值：undefined = 全部、null = 其他模型、string = 指定模型。 */
  modelFilter: string | null | undefined;
  models: string[];
  /** 选中模型筛选后回调（已换算 filter.model 三态口径）。 */
  onSelectModelFilter: (value: string | null | undefined) => void;
  rangeSheetVisible: boolean;
  onCloseRangeSheet: () => void;
  onConfirmRange: (from: Date, to: Date) => void;
  modelPickerVisible: boolean;
  onOpenModelPicker: () => void;
  onCloseModelPicker: () => void;
  tokens: ThemeTokens;
}) {
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
            {[
              {id: MODEL_OPTION_ALL, label: '全部模型'},
              ...models.map(m => ({id: m, label: m})),
              {id: MODEL_OPTION_UNLOGGED, label: '其他模型'},
            ].map(option => {
              const selected =
                option.id === MODEL_OPTION_ALL
                  ? modelFilter === undefined
                  : option.id === MODEL_OPTION_UNLOGGED
                  ? modelFilter === null
                  : modelFilter === option.id;
              return (
                <Pressable
                  key={option.id}
                  testID={`model-option-${option.id}`}
                  onPress={() => {
                    onSelectModelFilter(
                      option.id === MODEL_OPTION_ALL
                        ? undefined
                        : option.id === MODEL_OPTION_UNLOGGED
                        ? null
                        : option.id,
                    );
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
          </Pressable>
        </Pressable>
      </AppModal>
    </>
  );
}
