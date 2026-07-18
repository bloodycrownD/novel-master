/**
 * Mobile Composer：基于 `@bsky.app/tapper` 的 `@路径` 输入。
 * 对外 value / onChange 仍为纯字符串（含 `@/path`）。
 * 仅程序化插入（选择器 / @搜索 tips）的 facet 保持 committed → tag 着色 + 原子删；
 * 手输匹配在离开自动 commit 后会反标，不成 tag、不原子删。
 *
 * 草稿水化：历史正文里的 `@path` 经 replaceText 会全 committed（通常可接受，已是引用）。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import { Tapper, type TapperFacet } from '@bsky.app/tapper';
import { useTheme } from '@/theme/ThemeProvider';
import {
  COMPOSER_AT_PATH_FACET_PATTERN,
  uncommitHandTypedFacet,
} from './composer-at-path';

const IS_WEB = Platform.OS === 'web';

/** 两层共用的正文字体度量，避免高亮层与透明层基线错位加重影。 */
const SHARED_TEXT = {
  fontSize: 16,
  lineHeight: 22,
  paddingHorizontal: 4,
  paddingVertical: 6,
} as const;

export type ComposerAtPathInputHandle = {
  /**
   * 程序化整段写入（选择器插入等）。
   * 内部走 replaceText，匹配 facet 保持 committed。
   */
  replaceCommittedText: (text: string, cursor?: number) => void;
  /**
   * 程序化替换当前活跃 `@`（typeahead 点选）。
   * 优先 activeFacet.replace；无活跃 facet 时返回 false。
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
   * 仅在 `value` 与内部不一致而 `replaceText` 时使用。
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
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  /** 为 true 时 facetCommitted 不反标（选择器 / tips / 外部 value 同步）。 */
  const programmaticRef = useRef(false);
  const nativeInputRef = useRef<TextInput | null>(null);

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

  const emitSelection = useCallback(
    (start: number, end: number) => {
      onSelectionChange?.({
        nativeEvent: { selection: { start, end } },
      } as NativeSyntheticEvent<TextInputSelectionChangeEventData>);
    },
    [onSelectionChange],
  );

  /** native 非受控：程序化改字后用 setNativeProps 对齐可见文本。 */
  const syncNativeText = useCallback((text: string) => {
    if (IS_WEB) {
      return;
    }
    const el = nativeInputRef.current as
      | (TextInput & { setNativeProps?: (p: { text: string }) => void })
      | null;
    el?.setNativeProps?.({ text });
  }, []);

  const runProgrammatic = useCallback((fn: () => void) => {
    programmaticRef.current = true;
    try {
      fn();
    } finally {
      programmaticRef.current = false;
    }
  }, []);

  // 外部 value（草稿水化 / 选择器插入 / 清空）→ 内部；视为程序化 → 保持 committed
  useLayoutEffect(() => {
    if (value !== tapper.text) {
      const pos = Math.max(0, Math.min(cursorRef.current, value.length));
      runProgrammatic(() => {
        tapper.replaceText(value, pos);
        syncNativeText(value);
      });
    }
  }, [value, tapper, runProgrammatic, syncNativeText]);

  // 手输离开自动 commit → 反标，不成 tag、不原子删
  useEffect(() => {
    return tapper.on('facetCommitted', (facet: TapperFacet) => {
      if (programmaticRef.current) {
        return;
      }
      if (uncommitHandTypedFacet(tapper.nodes, facet)) {
        // 同文 insert('') 走 update 复用 nodes，刷新 snapshot
        tapper.insert('');
      }
    });
  }, [tapper]);

  useImperativeHandle(
    ref,
    () => ({
      replaceCommittedText(text: string, cursorPos?: number) {
        const pos =
          cursorPos != null
            ? Math.max(0, Math.min(cursorPos, text.length))
            : text.length;
        runProgrammatic(() => {
          tapper.replaceText(text, pos);
          syncNativeText(text);
        });
        onChangeText(tapper.text);
        emitSelection(tapper.selection.start, tapper.selection.end);
      },
      replaceActiveAt(token: string) {
        const active = tapper.activeFacet;
        if (active == null || active.type !== 'atPath') {
          return false;
        }
        runProgrammatic(() => {
          active.replace(token);
          syncNativeText(tapper.text);
        });
        onChangeText(tapper.text);
        emitSelection(tapper.selection.start, tapper.selection.end);
        return true;
      },
    }),
    [emitSelection, onChangeText, runProgrammatic, syncNativeText, tapper],
  );

  const setMergedRef = useCallback(
    (node: TextInput | null) => {
      nativeInputRef.current = node;
      tapper.setInputRef(node);
      if (inputRef) {
        (inputRef as React.MutableRefObject<TextInput | null>).current = node;
      }
    },
    [inputRef, tapper],
  );

  const handleChangeText = useCallback(
    (next: string) => {
      tapper.handleTextChange(next);
      // 原子删后 tapper.text 可能短于 next；native 非受控需对齐
      if (tapper.text !== next) {
        syncNativeText(tapper.text);
      }
      onChangeText(tapper.text);
      emitSelection(tapper.selection.start, tapper.selection.end);
    },
    [emitSelection, onChangeText, syncNativeText, tapper],
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
            // 仅已提交的程序化 @path 成 tag（着色）；手输 / trigger 不当 chip
            const isCommittedAtPath =
              node.type === 'facet' &&
              node.committed === true &&
              node.facetType === 'atPath';
            if (isCommittedAtPath) {
              return (
                <Text
                  key={node.id}
                  style={[styles.atToken, { color: tokens.primary }]}
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
        // web 受控；native 跟官方非受控，减轻 IME/叠层重影
        value={IS_WEB ? state.text : undefined}
        defaultValue={IS_WEB ? undefined : value}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        editable={editable}
        multiline
        caretHidden={false}
        selectionColor={tokens.primary}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  stack: {
    position: 'relative',
    width: '100%',
  },
  highlight: {
    minHeight: 56,
    maxHeight: 160,
    ...SHARED_TEXT,
  },
  // 仅改颜色，不加 fontWeight / 背景，避免与透明层度量不一致导致重影
  atToken: {},
  inputOverlay: {
    ...StyleSheet.absoluteFillObject,
    minHeight: 56,
    maxHeight: 160,
    ...SHARED_TEXT,
    backgroundColor: 'transparent',
    textAlignVertical: 'top',
  },
});
