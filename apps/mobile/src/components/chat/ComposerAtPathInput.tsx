/**
 * Mobile Composer：基于 react-native-controlled-mentions 的单层 `@路径` 输入。
 *
 * - 单个 TextInput + children 着色（无底层 Text / 上层透明叠层）
 * - 仅选择器 / @ 搜索 tips 经程序化 API 插入成 mention（着色 + 退格整段删）
 * - 手输 `@/path` 为普通字：不成 tag、不整段删
 * - 对外 value / onChangeText 始终为纯字符串（含 `@/path`），不落库 `{@}[…](id)`
 * - selection 仅短暂受控（对齐 PromptMacroTextInput 的 pendingSelection），避免全程受控打断 mention 着色
 */
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  StyleSheet,
  TextInput,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import {
  useMentions,
  type TriggersConfig,
} from 'react-native-controlled-mentions';
import { useTheme } from '@/theme/ThemeProvider';
import {
  mentionValueToPlain,
  mergeProgrammaticPlainIntoMentionValue,
  suggestionFromAtPathToken,
  tryAtomicMentionDelete,
} from './composer-at-path-mention';

export type ComposerAtPathInputHandle = {
  /**
   * 程序化整段写入（选择器插入等）。
   * 新增片段内的完整 `@path` 提成 mention；既有手输纯文本 `@path` 不提升。
   */
  replaceCommittedText: (text: string, cursor?: number) => void;
  /**
   * 程序化替换当前活跃 `@`（typeahead 点选）。
   * 走 mentions `onSelect`；无活跃 keyword 时返回 false。
   */
  replaceActiveAt: (token: string) => boolean;
};

export type ComposerAtPathInputProps = {
  inputRef?: RefObject<TextInput | null>;
  value: string;
  onChangeText: (text: string) => void;
  onSelectionChange?: (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => void;
  editable?: boolean;
  placeholder?: string;
  placeholderTextColor?: string;
  testID?: string;
  /** 与 ChatComposer 原 input 样式对齐的附加 style。 */
  style?: TextStyle;
  /**
   * 外部受控光标（插入 token / typeahead 替换后）。
   * 程序化写入后用于对齐 selection。
   */
  cursor?: number;
};

export const ComposerAtPathInput = forwardRef<
  ComposerAtPathInputHandle,
  ComposerAtPathInputProps
>(function ComposerAtPathInput(
  {
    inputRef,
    value,
    onChangeText,
    onSelectionChange,
    editable = true,
    placeholder,
    placeholderTextColor,
    testID,
    style,
    cursor = 0,
  },
  ref,
) {
  const { tokens } = useTheme();
  /** 内部 mention 值（可含 `{@}[path](path)`）；对外只发 plain。 */
  const [mentionValue, setMentionValue] = useState(value);
  /** 仅程序化写入时短暂传入 TextInput；用户划选后清空，避免全程受控。 */
  const [pendingSelection, setPendingSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const lastPlainRef = useRef(value);
  const triggersRef = useRef<ReturnType<typeof useMentions>['triggers'] | null>(
    null,
  );

  const triggersConfig: TriggersConfig<'atPath'> = useMemo(
    () => ({
      atPath: {
        trigger: '@',
        // 路径无空格；避免把后续字吞进 keyword
        allowedSpacesCount: 0,
        isInsertSpaceAfterMention: true,
        // 字色 + 轻底，与柔和 selection tint 可区分
        textStyle: {
          color: tokens.primary,
          backgroundColor: `${tokens.primary}22`,
        },
        // 展示为 @/path（name 已含前导 /）
        getPlainString: mention => `@${mention.name}`,
      },
    }),
    [tokens.primary],
  );

  const emitMentionValue = useCallback(
    (nextMention: string) => {
      const plain = mentionValueToPlain(nextMention);
      lastPlainRef.current = plain;
      setMentionValue(nextMention);
      onChangeText(plain);
    },
    [onChangeText],
  );

  const applyPendingSelection = useCallback(
    (start: number, end: number) => {
      setPendingSelection({ start, end });
      onSelectionChange?.({
        nativeEvent: { selection: { start, end } },
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
    [onSelectionChange],
  );

  const { textInputProps, triggers } = useMentions({
    value: mentionValue,
    onChange: emitMentionValue,
    triggersConfig,
    onSelectionChange: sel => {
      // 原生已应用选区后解除短暂受控（对照 PromptMacroTextInput）
      setPendingSelection(null);
      onSelectionChange?.({
        nativeEvent: { selection: { start: sel.start, end: sel.end } },
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
  });
  triggersRef.current = triggers;

  // 外部 value（草稿水化 / 清空）→ 内部；纯文本不成 tag
  useLayoutEffect(() => {
    if (value === lastPlainRef.current) {
      return;
    }
    lastPlainRef.current = value;
    setMentionValue(value);
    const pos = Math.max(0, Math.min(cursor, value.length));
    applyPendingSelection(pos, pos);
  }, [value, cursor, applyPendingSelection]);

  useImperativeHandle(
    ref,
    () => ({
      replaceCommittedText(text: string, cursorPos?: number) {
        const next = mergeProgrammaticPlainIntoMentionValue(
          mentionValue,
          text,
          triggersConfig,
        );
        emitMentionValue(next);
        const pos =
          cursorPos != null
            ? Math.max(0, Math.min(cursorPos, text.length))
            : text.length;
        applyPendingSelection(pos, pos);
      },
      replaceActiveAt(token: string) {
        const t = triggersRef.current?.atPath;
        if (t == null || t.keyword == null) {
          return false;
        }
        t.onSelect(suggestionFromAtPathToken(token));
        return true;
      },
    }),
    [applyPendingSelection, emitMentionValue, mentionValue, triggersConfig],
  );

  const setMergedRef = useCallback(
    (node: TextInput | null) => {
      if (inputRef) {
        (inputRef as React.MutableRefObject<TextInput | null>).current = node;
      }
    },
    [inputRef],
  );

  const handleChangeText = useCallback(
    (changedPlain: string) => {
      const atomic = tryAtomicMentionDelete(
        mentionValue,
        changedPlain,
        triggersConfig,
      );
      if (atomic != null) {
        emitMentionValue(atomic);
        return;
      }
      textInputProps.onChangeText(changedPlain);
    },
    [emitMentionValue, mentionValue, textInputProps, triggersConfig],
  );

  return (
    <TextInput
      ref={setMergedRef}
      testID={testID}
      style={[styles.input, style, { color: tokens.text }]}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      editable={editable}
      multiline
      caretHidden={false}
      selectionColor={tokens.selection}
      selection={pendingSelection ?? undefined}
      // 库要求：勿直接传 value；由 children 着色 + onChangeText 驱动
      onChangeText={handleChangeText}
      onSelectionChange={textInputProps.onSelectionChange}
    >
      {textInputProps.children}
    </TextInput>
  );
});

const styles = StyleSheet.create({
  input: {
    minHeight: 56,
    maxHeight: 160,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 4,
    paddingVertical: 6,
    width: '100%',
    textAlignVertical: 'top',
  },
});
