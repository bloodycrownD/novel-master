/**
 * 动态区多行输入（宏链壳）：props 面保持 main 版，内部换 `ComposerInputWebView`
 * （mode='prompt-macro'，单引擎 WebView 输入框）。
 *
 * main 版的 FormTextInput + children 着色链（`splitPromptMacroSegments` 逐段染色的
 * Text 子树、`tryAtomicMacroDelete` 的 RN 侧整段删）随 WebView 化整体退役：宏高亮
 * 分段、原子删、选区真源都在 web 单引擎内（`findWhitelistMacroRanges` 进 web
 * bundle，见 src/web/composer-input），RN 侧只做 props ↔ 桥消息的搬运。
 *
 * 仍是 RN 渲染的两块：
 * - chips 行：`PROMPT_INSERTABLE_MACROS` + `insertTextAtSelection` 算好整段文本，
 *   走宿主 `setText{text, selection}` 命令（web 侧 suppressChange 包裹，光标随
 *   payload 一次落位），并以 `pendingSelection` 短暂受控、等 web 回报选区即解除；
 * - 表单外壳：hairline 边框 / 圆角 12 / `tokens.bgSecondary` 底（复刻 main 版
 *   FormTextInput 外观）；内边距不在这里重复施加——web 侧按 metrics 的
 *   paddingH/paddingV（14/12）铺在高亮层与 textarea 上。
 *
 * disabled（只读详情）职责划分：输入区 readOnly + 灰显经 init.disabled /
 * setDisabled 下发 web；chips 的禁点与灰显（opacity 0.55）留在本壳。
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';
import type {
  ComposerInputMetrics,
  ComposerInputSelection,
  ComposerInputTheme,
} from '@/components/chat/ComposerInputBridge';
import {
  ComposerInputWebView,
  themeFromTokens,
  toNativeSelectionEvent,
  type ComposerInputWebViewHandle,
} from '@/components/chat/ComposerInputWebView';
import {
  PROMPT_INSERTABLE_MACROS,
  insertTextAtSelection,
} from './prompt-macro-input';

type Props = {
  tokens: ThemeTokens;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  /** 透传的内联限高样式（ExpandablePromptInput 传 maxHeight 176）→ 进 metrics。 */
  style?: StyleProp<TextStyle>;
  /** 外部短暂受控的选区（挂载视口置顶用）；内部程序化选区优先。 */
  selection?: {start: number; end: number};
  /** 外部 selectionChange：与内部共用一个回调链，两边都收到。 */
  onSelectionChange?: (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => void;
  /** 禁用态（只读详情）：输入框不可编辑、宏 chip 禁点并灰显。 */
  disabled?: boolean;
};

/** 宏链内联口径（与 main 版 FormTextInput 的 multiline 同值）：88 起自适应。 */
const BASE_METRICS: Omit<ComposerInputMetrics, 'maxHeight'> = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 14,
  paddingV: 12,
  minHeight: 88,
};

/**
 * 透传 style 里的内联限高（ExpandablePromptInput 的 8 行口径 176）→ metrics.maxHeight；
 * 未给 = null（宿主按「不限高」渲染，chat 全屏同语义）。
 */
function maxHeightFromStyle(style: StyleProp<TextStyle>): number | null {
  const flat = StyleSheet.flatten(style) as {maxHeight?: unknown} | undefined;
  const value = flat?.maxHeight;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function PromptMacroTextInput({
  tokens,
  value,
  onChangeText,
  placeholder,
  style,
  selection,
  onSelectionChange,
  disabled = false,
}: Props) {
  const webRef = useRef<ComposerInputWebViewHandle | null>(null);
  /** 最近一次 web 上报的选区（chips 插入基点）；初值照 main 版落文末。 */
  const selectionRef = useRef<ComposerInputSelection>({
    start: value.length,
    end: value.length,
  });
  /** 程序化写入后的短暂受控光标；任何来自 web 的选区回报即清空。 */
  const [pendingSelection, setPendingSelection] =
    useState<ComposerInputSelection | null>(null);

  const metrics = useMemo<ComposerInputMetrics>(
    () => ({...BASE_METRICS, maxHeight: maxHeightFromStyle(style)}),
    [style],
  );

  /**
   * 主题走 props.tokens 通道（chat 壳用 useTheme；宏壳保持外部传入语义）。
   * 字段映射与 chat 壳共用 `themeFromTokens`（单一真源，勿再写内联字面量）。
   */
  const theme = useMemo<ComposerInputTheme>(
    () => themeFromTokens(tokens),
    [tokens],
  );

  /** web 上报选区 → 解除短暂受控 + 合成 RN 事件形状上抛。 */
  const handleSelectionChange = useCallback(
    (next: ComposerInputSelection) => {
      selectionRef.current = next;
      setPendingSelection(null);
      onSelectionChange?.(toNativeSelectionEvent(next));
    },
    [onSelectionChange],
  );

  const insertMacro = useCallback(
    (token: string) => {
      const {next, selection: caret} = insertTextAtSelection(
        value,
        selectionRef.current,
        token,
      );
      selectionRef.current = caret;
      setPendingSelection(caret);
      // 命令式整段写入：web 侧 suppressChange 包裹，光标随 payload 一次落位；
      // 未 ready 时宿主拒写，改由 value 差分在 ready 后补齐（onChangeText 先行回流）。
      webRef.current?.setText(next, caret);
      onChangeText(next);
    },
    [onChangeText, value],
  );

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.shell,
          {
            backgroundColor: tokens.bgSecondary,
            borderColor: tokens.borderLight,
          },
        ]}
      >
        <ComposerInputWebView
          ref={webRef}
          mode="prompt-macro"
          value={value}
          /* 裸传 onChangeText：宏链父层（DynamicBlocksCard / PromptLayoutSection）
             虽是受控回写，但它写回的文本与 web 上报严格同值——回写必然等于
             宿主的 webTextRef 基线，`value` 差分 effect 短路，不会被误判成
             外部写入再摆一次选区。chat 壳另需「先推进 lastValueRef」是因为那边
             程序化写入（replaceCommittedText）会主动回调 onChangeText，那条回流
             路径需要壳级差分基线兜底；宏壳的程序化写入（insertMacro）同样先调
             命令式 setText（同步推进宿主基线）再上抛，链路上无第三条回写路径，
             故此处不加壳级差分包装。 */
          onChangeText={onChangeText}
          onSelectionChange={handleSelectionChange}
          disabled={disabled}
          selection={pendingSelection ?? selection ?? null}
          metrics={metrics}
          placeholder={placeholder}
          theme={theme}
        />
      </View>
      <View style={styles.chipRow}>
        <Text style={[styles.chipLabel, {color: tokens.textSecondary}]}>
          宏
        </Text>
        {PROMPT_INSERTABLE_MACROS.map(macro => (
          <Pressable
            key={macro.token}
            disabled={disabled}
            style={[
              styles.chip,
              {
                backgroundColor: `${tokens.primary}14`,
                borderColor: `${tokens.primary}33`,
              },
              disabled ? styles.chipDisabled : null,
            ]}
            onPress={() => insertMacro(macro.token)}
          >
            <Text style={[styles.chipText, {color: tokens.primary}]}>
              {macro.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {gap: 8},
  // 复刻 main 版 FormTextInput 外观（内边距由 web 按 metrics 施加）。
  shell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  chipLabel: {fontSize: 12, fontWeight: '600'},
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipDisabled: {opacity: 0.55},
  chipText: {fontSize: 13, fontWeight: '600'},
});
