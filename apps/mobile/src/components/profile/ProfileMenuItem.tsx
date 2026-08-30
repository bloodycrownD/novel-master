/**
 * Profile tab menu row (aligned with examples/mobile .menu-item).
 * 组合 ElevatedCard 承担卡片基础层（cr-fix-spec comp-rest/C-7），
 * 本组件只保留行内容（icon / label / value / chevron）。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';
import {chevron, iconWrap} from '../ui/card-styles';
import {ElevatedCard} from '../ui/ElevatedCard';

type Props = {
  icon: string;
  label: string;
  value?: string;
  onPress: () => void;
  tokens: ThemeTokens;
};

export function ProfileMenuItem({icon, label, value, onPress, tokens}: Props) {
  return (
    <ElevatedCard onPress={onPress} tokens={tokens}>
      <View style={[iconWrap, {backgroundColor: tokens.bgSecondary}]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={[styles.label, {color: tokens.text}]} numberOfLines={1}>
        {label}
      </Text>
      {value != null && value !== '' ? (
        <Text
          style={[styles.value, {color: tokens.textSecondary}]}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
      <Text style={[chevron, {color: tokens.textTertiary}]}>›</Text>
    </ElevatedCard>
  );
}

const styles = StyleSheet.create({
  icon: {fontSize: 24},
  label: {flex: 1, fontSize: 16, fontWeight: '600'},
  value: {maxWidth: '42%', fontSize: 14, textAlign: 'right'},
});
