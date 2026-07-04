/**
 * Compact select row that opens a bottom sheet list (for long option sets).
 */
import React, {useEffect, useId, useMemo, useState} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {ThemeTokens} from '../../theme/tokens';
import {useFormOverlay} from './FormOverlayHost';

export type SelectOption = {
  value: string;
  label: string;
  subtitle?: string;
  disabled?: boolean;
};

type Props = {
  tokens: ThemeTokens;
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  sheetTitle?: string;
  disabled?: boolean;
};

export function FormSelectField({
  tokens,
  value,
  options,
  onChange,
  placeholder = '请选择',
  emptyLabel = '暂无选项',
  sheetTitle,
  disabled = false,
}: Props) {
  const overlay = useFormOverlay();
  const overlayKey = useId();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => options.find(option => option.value === value),
    [options, value],
  );
  const isEmpty = options.length === 0;
  const display = isEmpty
    ? emptyLabel
    : selected?.label ?? placeholder;

  const close = () => setOpen(false);

  const select = (next: string) => {
    close();
    onChange(next);
  };

  useEffect(() => {
    if (!open || !overlay) {
      overlay?.hide(overlayKey);
      return;
    }

    overlay.show(
      overlayKey,
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[styles.sheet, {backgroundColor: tokens.surface}]}
          onPress={e => e.stopPropagation()}>
          {sheetTitle ? (
            <Text style={[styles.sheetTitle, {color: tokens.text}]}>
              {sheetTitle}
            </Text>
          ) : null}
          <FlatList
            data={options}
            keyExtractor={item => item.value}
            style={styles.list}
            renderItem={({item}) => {
              const active = item.value === value;
              return (
                <Pressable
                  disabled={item.disabled}
                  style={[
                    styles.row,
                    {borderBottomColor: tokens.border},
                    active && {backgroundColor: tokens.bgSecondary},
                    item.disabled && !active ? {opacity: 0.45} : null,
                  ]}
                  onPress={() => select(item.value)}>
                  <View style={styles.rowText}>
                    <Text style={{color: tokens.text}}>{item.label}</Text>
                    {item.subtitle ? (
                      <Text style={{color: tokens.textSecondary, fontSize: 13}}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {active ? (
                    <Text style={{color: tokens.primary}}>✓</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
          <View
            style={[
              styles.cancelWrap,
              {
                borderTopColor: tokens.border,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}>
            <Pressable onPress={close} style={styles.cancelBtn}>
              <Text style={{color: tokens.textSecondary}}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>,
    );

    return () => overlay.hide(overlayKey);
  }, [
    open,
    overlay,
    overlayKey,
    options,
    value,
    tokens,
    sheetTitle,
    insets.bottom,
  ]);

  return (
    <Pressable
      disabled={disabled || isEmpty}
      style={[
        styles.trigger,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
          opacity: disabled || isEmpty ? 0.55 : 1,
        },
      ]}
      onPress={() => setOpen(true)}>
      <Text
        style={{
          color: selected ? tokens.text : tokens.textSecondary,
          flex: 1,
        }}
        numberOfLines={1}>
        {display}
      </Text>
      {!isEmpty ? (
        <Text style={{color: tokens.textSecondary, fontSize: 12}}>▼</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 12,
  },
  list: {maxHeight: 360},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowText: {flex: 1, gap: 2},
  cancelWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {alignItems: 'center', paddingTop: 14},
});
