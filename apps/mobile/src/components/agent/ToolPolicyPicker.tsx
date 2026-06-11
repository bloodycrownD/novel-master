import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {BUILTIN_TOOL_CATALOG} from '@novel-master/config-forms/agent';
import {FormTextInput} from '../form/FormTextInput';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  tokens: ThemeTokens;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
};

export function ToolPolicyPicker({tokens, selected, onChange}: Props) {
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') {
      return BUILTIN_TOOL_CATALOG;
    }
    return BUILTIN_TOOL_CATALOG.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [query]);

  const toggle = (name: string) => {
    if (selectedSet.has(name)) {
      onChange(selected.filter(n => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  const remove = (name: string) => {
    onChange(selected.filter(n => n !== name));
  };

  return (
    <View style={styles.wrap}>
      {selected.length > 0 ? (
        <View style={styles.chipRow}>
          {selected.map(name => (
            <Pressable
              key={name}
              style={[
                styles.chip,
                {
                  borderColor: tokens.primary,
                  backgroundColor: tokens.bgSecondary,
                },
              ]}
              onPress={() => remove(name)}>
              <Text style={{color: tokens.primary, fontWeight: '600'}}>
                {name} ×
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <FormTextInput
        tokens={tokens}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索工具…"
      />
      <View style={styles.list}>
        {filtered.map(item => {
          const checked = selectedSet.has(item.name);
          return (
            <Pressable
              key={item.name}
              style={[
                styles.row,
                {borderColor: tokens.borderLight},
              ]}
              onPress={() => toggle(item.name)}>
              <Text style={{color: tokens.text, width: 24}}>
                {checked ? '☑' : '☐'}
              </Text>
              <View style={styles.rowBody}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.name}
                </Text>
                <Text style={[styles.desc, {color: tokens.textSecondary}]}>
                  {item.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {gap: 10},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  list: {gap: 4},
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: {flex: 1, gap: 2},
  name: {fontSize: 15, fontWeight: '600'},
  desc: {fontSize: 13},
});
