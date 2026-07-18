/**
 * Mobile Composer：基于 `@bsky.app/tapper` 的 `@路径` 输入。
 * 对外 value / onChange 仍为纯字符串（含 `@/path`）；已提交 facet 支持原子退格删除。
 */
import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import { Tapper } from '@bsky.app/tapper';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPOSER_AT_PATH_FACET_PATTERN } from './composer-at-path';

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
   * 仅在 `value` 与内部不一致而 `replaceText` 时使用。
   */
  cursor?: number;
};

export function ComposerAtPathInput({
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
}: ComposerAtPathInputProps) {
  const { tokens } = useTheme();
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const [tapper] = useState(
    () =>
      new Tapper({
        facets: {
          // 与 scanAtPath / 历史高亮同口径；boundary 前缀供 tapper 剥离
          atPath: COMPOSER_AT_PATH_FACET_PATTERN,
        },
        initialText: value,
      }),
  );

  const state = useSyncExternalStore(tapper.subscribe, tapper.getSnapshot);

  // 外部 value（草稿水化 / 选择器插入 / 清空）→ 内部；匹配 facet 一律标为已提交
  useLayoutEffect(() => {
    if (value !== tapper.text) {
      const pos = Math.max(0, Math.min(cursorRef.current, value.length));
      tapper.replaceText(value, pos);
    }
  }, [value, tapper]);

  const setMergedRef = useCallback(
    (node: TextInput | null) => {
      tapper.setInputRef(node);
      if (inputRef) {
        (inputRef as React.MutableRefObject<TextInput | null>).current = node;
      }
    },
    [inputRef, tapper],
  );

  const emitSelection = useCallback(
    (start: number, end: number) => {
      onSelectionChange?.({
        nativeEvent: { selection: { start, end } },
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
    [onSelectionChange],
  );

  const handleChangeText = useCallback(
    (next: string) => {
      tapper.handleTextChange(next);
      // 原子删后 tapper.text 可能短于 next；边界始终吐纯字符串
      onChangeText(tapper.text);
      emitSelection(tapper.selection.start, tapper.selection.end);
    },
    [emitSelection, onChangeText, tapper],
  );

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      tapper.handleSelectionChange(e);
      emitSelection(tapper.selection.start, tapper.selection.end);
    },
    [emitSelection, tapper],
  );

  return (
    <View style={styles.stack}>
      <Text
        style={[styles.highlight, style, { color: tokens.text }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {state.nodes.length === 0 ? (
          <Text>{'\u200b'}</Text>
        ) : (
          state.nodes.map(node => {
            const isAtPath =
              (node.type === 'facet' || node.type === 'trigger') &&
              node.facetType === 'atPath';
            if (isAtPath) {
              return (
                <Text
                  key={node.id}
                  style={[
                    styles.atToken,
                    {
                      color: tokens.primary,
                      backgroundColor: `${tokens.primary}29`,
                    },
                  ]}
                >
                  {node.raw}
                </Text>
              );
            }
            return <Text key={node.id}>{node.raw}</Text>;
          })
        )}
      </Text>
      <TextInput
        ref={setMergedRef}
        testID={testID}
        style={[styles.inputOverlay, style, { color: 'transparent' }]}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        // 受控：保证 replaceText / 原子删后原生框与纯文本 value 一致
        value={state.text}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        editable={editable}
        multiline
        caretHidden={false}
        selectionColor={tokens.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    position: 'relative',
    width: '100%',
  },
  highlight: {
    minHeight: 56,
    maxHeight: 160,
    paddingHorizontal: 4,
    paddingVertical: 6,
    fontSize: 16,
  },
  atToken: {
    fontWeight: '500',
    borderRadius: 4,
    overflow: 'hidden',
  },
  inputOverlay: {
    ...StyleSheet.absoluteFillObject,
    minHeight: 56,
    maxHeight: 160,
    paddingHorizontal: 4,
    paddingVertical: 6,
    fontSize: 16,
    backgroundColor: 'transparent',
    textAlignVertical: 'top',
  },
});
