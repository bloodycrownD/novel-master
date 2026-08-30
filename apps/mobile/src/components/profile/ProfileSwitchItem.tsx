/**
 * Profile tab row with a trailing switch (no navigation chevron).
 * 卡片基础样式来自 card-styles 单源（cr-fix-spec comp-rest/C-7）。
 */
import React from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';
import type {ThemeTokens} from '@/theme/tokens';
import {cardRow, cardSurface, iconWrap} from '../ui/card-styles';

type Props = {
  icon: string;
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  tokens: ThemeTokens;
};

export function ProfileSwitchItem({
  icon,
  label,
  subtitle,
  value,
  onValueChange,
  tokens,
}: Props) {
  return (
    <View style={[cardRow, cardSurface(tokens)]}>
      <View style={[iconWrap, {backgroundColor: tokens.bgSecondary}]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <View style={styles.textCol}>
        <Text style={[styles.label, {color: tokens.text}]}>{label}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, {color: tokens.textSecondary}]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{false: tokens.border, true: tokens.primary}}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {fontSize: 24},
  textCol: {flex: 1, gap: 4},
  label: {fontSize: 16, fontWeight: '600'},
  subtitle: {fontSize: 13, lineHeight: 18},
});
