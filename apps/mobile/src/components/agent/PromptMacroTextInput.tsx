/**
 * 动态区多行输入：白名单宏着色 + 退格/删除整段删；对外始终纯文本。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';
import {FormTextInput} from '../form/FormTextInput';
import {
  PROMPT_INSERTABLE_MACROS,
  insertTextAtSelection,
  splitPromptMacroSegments,
  tryAtomicMacroDelete,
} from './prompt-macro-input';

type Props = {
  tokens: ThemeTokens;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
};

export function PromptMacroTextInput({
  tokens,
  value,
  onChangeText,
  placeholder,
}: Props) {
  const selectionRef = useRef({start: value.length, end: value.length});
  const prevValueRef = useRef(value);
  const [pendingSelection, setPendingSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = event.nativeEvent.selection;
      setPendingSelection(null);
    },
    [],
  );

  const handleChangeText = useCallback(
    (next: string) => {
      const atomic = tryAtomicMacroDelete(prevValueRef.current, next);
      const resolved = atomic ?? next;
      prevValueRef.current = resolved;
      onChangeText(resolved);
    },
    [onChangeText],
  );

  const insertMacro = useCallback(
    (token: string) => {
      const {next, selection} = insertTextAtSelection(
        value,
        selectionRef.current,
        token,
      );
      prevValueRef.current = next;
      onChangeText(next);
      selectionRef.current = selection;
      setPendingSelection(selection);
    },
    [onChangeText, value],
  );

  useEffect(() => {
    prevValueRef.current = value;
  }, [value]);

  const segments = splitPromptMacroSegments(value);

  return (
    <View style={styles.root}>
      <FormTextInput
        tokens={tokens}
        value={value}
        onChangeText={handleChangeText}
        onSelectionChange={handleSelectionChange}
        selection={pendingSelection ?? undefined}
        multiline
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}>
        {segments.length === 0 ? null : (
          <Text>
            {segments.map((segment, index) =>
              segment.kind === 'macro' ? (
                <Text
                  key={`m-${index}-${segment.value}`}
                  style={{
                    color: tokens.primary,
                    backgroundColor: `${tokens.primary}22`,
                  }}>
                  {segment.value}
                </Text>
              ) : (
                <Text key={`t-${index}`} style={{color: tokens.text}}>
                  {segment.value}
                </Text>
              ),
            )}
          </Text>
        )}
      </FormTextInput>
      <View style={styles.chipRow}>
        <Text style={[styles.chipLabel, {color: tokens.textSecondary}]}>
          宏
        </Text>
        {PROMPT_INSERTABLE_MACROS.map(macro => (
          <Pressable
            key={macro.token}
            style={[
              styles.chip,
              {
                backgroundColor: `${tokens.primary}14`,
                borderColor: `${tokens.primary}33`,
              },
            ]}
            onPress={() => insertMacro(macro.token)}>
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
  chipText: {fontSize: 13, fontWeight: '600'},
});
