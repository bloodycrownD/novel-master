/**
 * Mobile Composer：基于 react-native-controlled-mentions 的单层输入。
 *
 * - `@path`：选择器 / typeahead 程序化插入成 mention（着色 + 退格整段删）
 * - 消息批注：独立 `§` trigger（仅解析/程序化插入，`suggest` 恒空）；短标签不以 `@` 开头
 * - 手输 `@/path` 为普通字：不成 tag、不整段删
 * - 对外 value / onChangeText 始终为展示 plain；发送用 getSendUserContent（剥离消息批注）
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
  mentionValueToSendUserContent,
  mergeProgrammaticPlainIntoMentionValue,
  suggestionFromAtPathToken,
  tryAtomicMentionDelete,
  type ComposerTriggersConfig,
} from './composer-at-path-mention';
import {
  MESSAGE_ANNOTATE_TRIGGER,
  formatMessageAnnotateMentionMarkup,
  listMessageAnnotateDraftIdsInMentionValue,
} from './composer-message-annotate-mention';

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
  /** 程序化插入消息批注 tag（`§` trigger）。 */
  insertMessageAnnotate: (draft: {
    id: string;
    originalText: string;
  }) => void;
  /**
   * 发送用 plain：剥离全部消息批注 mention span。
   * 作为 `runAgentTurn.userContent`（App 勿另调 scan）。
   */
  getSendUserContent: () => string;
};

export type ComposerAtPathInputProps = {
  inputRef?: RefObject<TextInput | null>;
  value: string;
  onChangeText: (text: string) => void;
  onSelectionChange?: (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => void;
  /** 原子删 / 清空消息批注 tag 时回调（同步 removeMessageAnnotateDraft）。 */
  onMessageAnnotateRemoved?: (draftIds: readonly string[]) => void;
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
    onMessageAnnotateRemoved,
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
  /** 内部 mention 值（可含 `{@}[…](…)` / `{§}[…](…)`）；对外只发展示 plain。 */
  const [mentionValue, setMentionValue] = useState(value);
  /** 仅程序化写入时短暂传入 TextInput；用户划选后清空，避免全程受控。 */
  const [pendingSelection, setPendingSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const lastPlainRef = useRef(value);
  const mentionValueRef = useRef(mentionValue);
  mentionValueRef.current = mentionValue;
  const onMessageAnnotateRemovedRef = useRef(onMessageAnnotateRemoved);
  onMessageAnnotateRemovedRef.current = onMessageAnnotateRemoved;
  const triggersRef = useRef<ReturnType<typeof useMentions>['triggers'] | null>(
    null,
  );

  const triggersConfig: ComposerTriggersConfig = useMemo(
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
      msgAnnotate: {
        trigger: MESSAGE_ANNOTATE_TRIGGER,
        allowedSpacesCount: 0,
        isInsertSpaceAfterMention: true,
        textStyle: {
          color: tokens.primary,
          backgroundColor: `${tokens.primary}18`,
        },
        // 短标签不以 `@` 开头
        getPlainString: mention => mention.name,
      },
    }),
    [tokens.primary],
  );

  const syncRemovedMessageAnnotates = useCallback(
    (prevMention: string, nextMention: string) => {
      const prevIds = new Set(
        listMessageAnnotateDraftIdsInMentionValue(prevMention),
      );
      const nextIds = new Set(
        listMessageAnnotateDraftIdsInMentionValue(nextMention),
      );
      const removed: string[] = [];
      for (const id of prevIds) {
        if (!nextIds.has(id)) {
          removed.push(id);
        }
      }
      if (removed.length > 0) {
        onMessageAnnotateRemovedRef.current?.(removed);
      }
    },
    [],
  );

  const emitMentionValue = useCallback(
    (nextMention: string) => {
      const prev = mentionValueRef.current;
      const plain = mentionValueToPlain(nextMention);
      lastPlainRef.current = plain;
      mentionValueRef.current = nextMention;
      setMentionValue(nextMention);
      syncRemovedMessageAnnotates(prev, nextMention);
      onChangeText(plain);
    },
    [onChangeText, syncRemovedMessageAnnotates],
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
    triggersConfig: triggersConfig as TriggersConfig<'atPath' | 'msgAnnotate'>,
    onSelectionChange: sel => {
      // 原生已应用选区后解除短暂受控（对照 PromptMacroTextInput）
      setPendingSelection(null);
      onSelectionChange?.({
        nativeEvent: {selection: {start: sel.start, end: sel.end}},
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
  });
  triggersRef.current = triggers;

  // 外部 value（草稿水化 / 清空）→ 内部；纯文本不成 tag
  useLayoutEffect(() => {
    if (value === lastPlainRef.current) {
      return;
    }
    const prev = mentionValueRef.current;
    lastPlainRef.current = value;
    mentionValueRef.current = value;
    setMentionValue(value);
    syncRemovedMessageAnnotates(prev, value);
    const pos = Math.max(0, Math.min(cursor, value.length));
    applyPendingSelection(pos, pos);
  }, [value, cursor, applyPendingSelection, syncRemovedMessageAnnotates]);

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
      replaceActiveAt(token: string) {
        const t = triggersRef.current?.atPath;
        if (t == null || t.keyword == null) {
          return false;
        }
        t.onSelect(suggestionFromAtPathToken(token));
        return true;
      },
      insertMessageAnnotate(draft) {
        const markup = formatMessageAnnotateMentionMarkup(
          draft.id,
          draft.originalText,
        );
        const prev = mentionValueRef.current;
        const gap =
          prev.length === 0 || /\s$/.test(mentionValueToPlain(prev))
            ? ''
            : ' ';
        const next = `${prev}${gap}${markup} `;
        emitMentionValue(next);
        const plain = mentionValueToPlain(next);
        applyPendingSelection(plain.length, plain.length);
      },
      getSendUserContent() {
        return mentionValueToSendUserContent(mentionValueRef.current);
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
      textInputProps.onChangeText(changedPlain);
    },
    [emitMentionValue, mentionValue, textInputProps, triggersConfig],
  );

  // msgAnnotate：仅解析/程序化插入；suggest 恒空（不挂 typeahead）
  void triggers.msgAnnotate;

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
