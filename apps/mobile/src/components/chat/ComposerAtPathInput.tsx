/**
 * Mobile Composer：基于 react-native-controlled-mentions 的单层输入。
 *
 * - `@path`：选择器 / typeahead 程序化插入成 mention（着色 + 退格整段删）
 * - 手输 `@/path` 为普通字：不成 tag、不整段删
 * - 对外 value / onChangeText 始终为展示 plain
 * - selection 仅短暂受控（对齐 PromptMacroTextInput 的 pendingSelection）
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
import {useTheme} from '@/theme/ThemeProvider';
import {
  mentionValueToPlain,
  mergeProgrammaticPlainIntoMentionValue,
  promotePlainMentions,
  suggestionFromAtPathToken,
  suggestionFromSkillToken,
  tryAtomicMentionDelete,
  type ComposerTriggersConfig,
} from './composer-at-path-mention';

export type ComposerAtPathInputHandle = {
  /**
   * 程序化整段写入（选择器插入等）。
   * 新增片段内的完整 `@path` 提成 mention；既有手输纯文本 `@path` 不提升。
   */
  replaceCommittedText: (text: string, cursor?: number) => void;
  /**
   * 程序化替换当前活跃 `@` / `$`（typeahead 点选）。
   * 走 mentions `onSelect`；无活跃 keyword 时返回 false。
   */
  replaceActiveAt: (token: string, trigger?: 'atPath' | 'skill') => boolean;
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
  const {tokens} = useTheme();

  const triggersConfig: ComposerTriggersConfig = useMemo(
    () => ({
      atPath: {
        trigger: '@',
        // 路径无空格；避免把后续字吞进 keyword
        allowedSpacesCount: 0,
        isInsertSpaceAfterMention: true,
        // 字色 + 轻底胶囊，与柔和 selection tint 可区分
        textStyle: {
          color: tokens.primary,
          backgroundColor: `${tokens.primary}22`,
          borderRadius: 6,
          paddingHorizontal: 3,
        },
        // 展示为 @/path（name 已含前导 /）
        getPlainString: mention => `@${mention.name}`,
      },
      // `$技能名` 显式引用：与 @path 同款着色 / 原子删 / 尾空格
      skill: {
        trigger: '$',
        allowedSpacesCount: 0,
        isInsertSpaceAfterMention: true,
        textStyle: {
          color: tokens.primary,
          backgroundColor: `${tokens.primary}22`,
          borderRadius: 6,
          paddingHorizontal: 3,
        },
        getPlainString: mention => `$${mention.name}`,
      },
    }),
    [tokens.primary],
  );

  /** 内部 mention 值（可含 `{@}[…](…)`）；对外只发展示 plain。初次挂载即提升完整 token，恢复 tag 效果。 */
  const [mentionValue, setMentionValue] = useState(() =>
    promotePlainMentions(value, triggersConfig),
  );
  /** 仅程序化写入时短暂传入 TextInput；用户划选后清空，避免全程受控。 */
  const [pendingSelection, setPendingSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const lastPlainRef = useRef(value);
  const mentionValueRef = useRef(mentionValue);
  mentionValueRef.current = mentionValue;
  // 自愈对账用：handleChangeText 进入库处理前记录原生上报（markup 形态），
  // emitMentionValue 消费后清空；原子删/程序化写入不设置、不受影响。
  const nativeTruthRef = useRef<string | null>(null);
  const triggersRef = useRef<ReturnType<typeof useMentions>['triggers'] | null>(
    null,
  );

  const emitMentionValue = useCallback(
    (nextMention: string) => {
      // 自愈对账（2026-09 输入变删除案）：mention 库的差分→重建在 IME
      // 组合期会吃字符（实测：原生 660 → 重建值 657，光标处组合文本整段丢失）。
      // 重建结果与原生上报不等时以原生文本为准（原生文本本就是 markup
      // 形态，直接作为新 mentionValue，tag 状态由 useMentions 重解析）。
      // truth 每次消费后即清空：原子删/程序化写入路径不受影响。
      let resolved = nextMention;
      const truth = nativeTruthRef.current;
      if (truth != null && resolved !== truth) {
        resolved = truth;
      }
      nativeTruthRef.current = null;
      const plain = mentionValueToPlain(resolved);
      lastPlainRef.current = plain;
      mentionValueRef.current = resolved;
      setMentionValue(resolved);
      onChangeText(plain);
    },
    [onChangeText],
  );

  const applyPendingSelection = useCallback(
    (start: number, end: number) => {
      setPendingSelection({start, end});
      onSelectionChange?.({
        nativeEvent: {selection: {start, end}},
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
    [onSelectionChange],
  );

  const {textInputProps, triggers} = useMentions({
    value: mentionValue,
    onChange: emitMentionValue,
    triggersConfig: triggersConfig as TriggersConfig<'atPath' | 'skill'>,
    onSelectionChange: sel => {
      // 原生已应用选区后解除短暂受控（对照 PromptMacroTextInput）
      setPendingSelection(null);
      onSelectionChange?.({
        nativeEvent: {selection: {start: sel.start, end: sel.end}},
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
  });
  triggersRef.current = triggers;

  // 外部 value（草稿水化 / 清空）→ 内部；提升完整 token 恢复 tag，纯文本不成 tag 的语义不变
  useLayoutEffect(() => {
    if (value === lastPlainRef.current) {
      return;
    }
    lastPlainRef.current = value;
    const hydrated = promotePlainMentions(value, triggersConfig);
    mentionValueRef.current = hydrated;
    setMentionValue(hydrated);
    const pos = Math.max(0, Math.min(cursor, value.length));
    applyPendingSelection(pos, pos);
  }, [value, cursor, applyPendingSelection, triggersConfig]);

  useImperativeHandle(
    ref,
    () => ({
      replaceCommittedText(text: string, cursorPos?: number) {
        const next = mergeProgrammaticPlainIntoMentionValue(
          mentionValueRef.current,
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
      replaceActiveAt(token: string, trigger: 'atPath' | 'skill' = 'atPath') {
        const t = triggersRef.current?.[trigger];
        if (t == null || t.keyword == null) {
          return false;
        }
        t.onSelect(
          trigger === 'skill'
            ? suggestionFromSkillToken(token)
            : suggestionFromAtPathToken(token),
        );
        return true;
      },
    }),
    [applyPendingSelection, emitMentionValue, triggersConfig],
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
      // 记录原生上报供 emitMentionValue 对账（原子删已提前 return，不会误伤）。
      nativeTruthRef.current = changedPlain;
      textInputProps.onChangeText(changedPlain);
    },
    [emitMentionValue, mentionValue, textInputProps, triggersConfig],
  );

  return (
    <TextInput
      ref={setMergedRef}
      testID={testID}
      style={[styles.input, style, {color: tokens.text}]}
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
