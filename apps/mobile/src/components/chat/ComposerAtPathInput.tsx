/**
 * Mobile Composer 输入壳（chat 链）：props 面保持 main 版，内部换
 * `ComposerInputWebView`（单引擎 WebView 输入框，mode=composer-token）。
 *
 * main 版 controlled-mentions 全链（useMentions / nativeTruthRef 自愈对账 /
 * promotePlainMentions / replaceActiveAt 的 mention onSelect）随 WebView 化整体消失：
 * 高亮分段、原子删、选区真源都在 web 单引擎内（`composer-highlight` +
 * `atomic-range-delete` 进 web bundle），RN 侧只做 props ↔ 桥消息的搬运。
 *
 * 对外口径不变：`value` / `onChangeText` 始终为展示 plain；`onSelectionChange`
 * 合成 RN 事件形状（`nativeEvent.selection.start`，ChatComposer 的 setCursor 链）。
 *
 * 失效但保留的 props（Step 7 与 ChatComposer 一并删除，现在删会打红 typecheck）：
 * `inputRef`（main 版 TextInput 引用，已无消费）、`placeholderTextColor`
 * （占位色改由 web 主题驱动）。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  StyleSheet,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputSelectionChangeEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import type {
  ComposerInputMetrics,
  ComposerInputSelection,
} from './ComposerInputBridge';
import {
  ComposerInputWebView,
  type ComposerInputWebViewHandle,
} from './ComposerInputWebView';

/** chat 内联口径（与 main 版 TextInput 样式同值）：56 起、160 封顶后内滚。 */
const DEFAULT_METRICS = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 160,
} satisfies ComposerInputMetrics;

/** style 中由 metrics 消费的键；其余键原样透传给容器。 */
const METRIC_STYLE_KEYS: readonly string[] = [
  'fontSize',
  'lineHeight',
  'paddingHorizontal',
  'paddingVertical',
  'minHeight',
  'maxHeight',
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 光标落点归一到 [0, text.length]（对齐 main 版 clamp 口径）。 */
function clampCursor(value: number, length: number): number {
  if (!Number.isFinite(value)) {
    return length;
  }
  return Math.max(0, Math.min(Math.floor(value), length));
}

/**
 * style 拆分：白名单键覆盖合入 metrics，其余键透传容器
 * （ChatComposer 的 `styles.input` 里 width / textAlignVertical 归容器）。
 */
function splitInputStyle(style: StyleProp<TextStyle>): {
  metrics: ComposerInputMetrics;
  container: StyleProp<ViewStyle>;
} {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const numberOr = (key: string, fallback: number): number => {
    const value = flat[key];
    return isFiniteNumber(value) ? value : fallback;
  };
  const metrics: ComposerInputMetrics = {
    fontSize: numberOr('fontSize', DEFAULT_METRICS.fontSize),
    lineHeight: numberOr('lineHeight', DEFAULT_METRICS.lineHeight),
    paddingH: numberOr('paddingHorizontal', DEFAULT_METRICS.paddingH),
    paddingV: numberOr('paddingVertical', DEFAULT_METRICS.paddingV),
    minHeight: numberOr('minHeight', DEFAULT_METRICS.minHeight),
    maxHeight: numberOr('maxHeight', DEFAULT_METRICS.maxHeight),
  };
  const container: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!METRIC_STYLE_KEYS.includes(key)) {
      container[key] = value;
    }
  }
  return {metrics, container: container as ViewStyle};
}

export type ComposerAtPathInputHandle = {
  /**
   * 程序化整段写入（typeahead 点选 / 引用选择器插入）。
   * 手输即时高亮后无「提升成 tag」概念：整段纯文本写入 + 光标一次落位。
   */
  replaceCommittedText: (text: string, cursor?: number) => void;
  /**
   * @deprecated typeahead 点选已统一走 `replaceCommittedText` 单路径（本迭代口径）；
   * 方法保留只为类型兼容（ChatComposer 的旧分支，Step 7 拆除）。恒返回 false，
   * 调用方随即回落到 buildTokenInsertion + replaceCommittedText。
   */
  replaceActiveAt: (token: string, trigger?: 'atPath' | 'skill') => boolean;
};

export type ComposerAtPathInputProps = {
  /** 已失效：main 版 TextInput 引用（Step 7 删）。 */
  inputRef?: unknown;
  value: string;
  onChangeText: (text: string) => void;
  onSelectionChange?: (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => void;
  editable?: boolean;
  placeholder?: string;
  /** 已失效：占位色由 web 主题驱动（Step 7 删）。 */
  placeholderTextColor?: unknown;
  testID?: string;
  /** 与 ChatComposer 原 input 样式对齐：metrics 白名单键驱动 web，其余透传容器。 */
  style?: StyleProp<TextStyle>;
  /**
   * 外部受控光标（插入 token / 水化 / 清空后）。
   * 与 main 版同语义：仅在 value 主动变化时对齐，用户划选后不再受控。
   */
  cursor?: number;
};

export const ComposerAtPathInput = forwardRef<
  ComposerAtPathInputHandle,
  ComposerAtPathInputProps
>(function ComposerAtPathInput(
  {
    value,
    onChangeText,
    onSelectionChange,
    editable = true,
    placeholder,
    testID,
    style,
    cursor = 0,
  },
  ref,
) {
  const webRef = useRef<ComposerInputWebViewHandle | null>(null);
  /** 最近一次对外的 value：差分识别水化 / 清空等外部写入（main 版 lastPlainRef）。 */
  const lastValueRef = useRef(value);
  /** 外部写入的光标期望（短暂受控）：web 上报用户选区后解除。 */
  const [pendingSelection, setPendingSelection] =
    useState<ComposerInputSelection | null>(null);

  const {metrics, container} = useMemo(() => splitInputStyle(style), [style]);

  /**
   * 合成 RN 选区事件（ChatComposer 读 `nativeEvent.selection.start`）。
   * `TextInputSelectionChangeEventData` 的 target 等字段为 TextInput 专属，
   * 这里只补 selection，其余按 main 版口径整体断言类型。
   */
  const emitSelection = useCallback(
    (start: number, end: number) => {
      onSelectionChange?.({
        nativeEvent: {selection: {start, end}},
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
    [onSelectionChange],
  );

  /** web 上报选区 → 合成 RN 事件形状。 */
  const handleSelectionChange = useCallback(
    (selection: ComposerInputSelection) => {
      // 用户选区到达即解除短暂受控（对齐 main 版：原生已应用选区后置空 pendingSelection）。
      setPendingSelection(null);
      emitSelection(selection.start, selection.end);
    },
    [emitSelection],
  );

  // 外部 value 变化（草稿水化 / 发送清空 / 全屏回填）：光标期望对齐 cursor 后随
  // setText 下发；选区期望由 selection prop 走宿主受控通道（web 上报即解除）。
  useEffect(() => {
    if (value === lastValueRef.current) {
      return;
    }
    lastValueRef.current = value;
    const pos = clampCursor(cursor, value.length);
    setPendingSelection({start: pos, end: pos});
    emitSelection(pos, pos);
  }, [value, cursor, emitSelection]);

  useImperativeHandle(
    ref,
    () => ({
      replaceCommittedText(text: string, cursorPos?: number) {
        const pos = clampCursor(cursorPos ?? text.length, text.length);
        // 本条写入由 RN 发起：差分基线先行推进（value prop 回流不算外部变化），
        // web 侧文本基线由宿主 setText 同步；光标经 setText.selection 一次落位。
        lastValueRef.current = text;
        setPendingSelection(null);
        webRef.current?.setText(text, {start: pos, end: pos});
        // main 版同口径：程序化写入同样回调 onChangeText（ChatComposer 的 text /
        // 草稿状态靠它同步）与合成选区事件（cursor 落位）。
        onChangeText(text);
        emitSelection(pos, pos);
      },
      replaceActiveAt() {
        // 保留方法体：恒 false，调用方回落单路径（见类型注释）。
        return false;
      },
    }),
    [emitSelection, onChangeText],
  );

  return (
    <ComposerInputWebView
      ref={webRef}
      mode="composer-token"
      testID={testID}
      style={container}
      value={value}
      onChangeText={onChangeText}
      onSelectionChange={handleSelectionChange}
      disabled={!editable}
      selection={pendingSelection}
      metrics={metrics}
      placeholder={placeholder}
    />
  );
});
