/**
 * Mobile：透明 TextInput + 背后 Text 分段着色 `@路径`（value/落库仍为纯字符串）。
 */
import React, { useMemo, type RefObject } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
  type TextStyle,
} from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { segmentComposerAtPathHighlight } from './composer-at-path-highlight';

export type {
  ComposerAtPathSegment,
} from './composer-at-path-highlight';
export { segmentComposerAtPathHighlight } from './composer-at-path-highlight';

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
}: ComposerAtPathInputProps) {
  const { tokens } = useTheme();
  const segments = useMemo(() => segmentComposerAtPathHighlight(value), [value]);

  return (
    <View style={styles.stack}>
      <Text
        style={[styles.highlight, style, { color: tokens.text }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {segments.length === 0 ? (
          // 占位保持与空输入同高，避免布局塌陷
          <Text>{'\u200b'}</Text>
        ) : (
          segments.map((seg, i) =>
            seg.kind === 'at-token' ? (
              <Text
                key={`at-${i}`}
                style={[
                  styles.atToken,
                  {
                    color: tokens.primary,
                    backgroundColor: `${tokens.primary}29`,
                  },
                ]}
              >
                {seg.value}
              </Text>
            ) : (
              <Text key={`t-${i}`}>{seg.value}</Text>
            ),
          )
        )}
      </Text>
      <TextInput
        ref={inputRef}
        testID={testID}
        style={[styles.inputOverlay, style, { color: 'transparent' }]}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        editable={editable}
        multiline
        // 透明字 + 可见 caret；高亮层在背后着色
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
