/**
 * Profile tab row with a trailing switch (no navigation chevron).
 */
import React from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

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
    <View
      style={[
        styles.card,
        {
          backgroundColor: tokens.surfaceElevated,
          borderColor: tokens.borderLight,
        },
      ]}>
      <View style={[styles.iconWrap, {backgroundColor: tokens.bgSecondary}]}>
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 5,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {fontSize: 24},
  textCol: {flex: 1, gap: 4},
  label: {fontSize: 16, fontWeight: '600'},
  subtitle: {fontSize: 13, lineHeight: 18},
});
