/**
 * Profile tab menu row (aligned with examples/mobile .menu-item).
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  icon: string;
  label: string;
  value?: string;
  onPress: () => void;
  tokens: ThemeTokens;
};

export function ProfileMenuItem({icon, label, value, onPress, tokens}: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        styles.card,
        {
          backgroundColor: tokens.surfaceElevated,
          borderColor: tokens.borderLight,
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      <View style={[styles.iconWrap, {backgroundColor: tokens.bgSecondary}]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={[styles.label, {color: tokens.text}]} numberOfLines={1}>
        {label}
      </Text>
      {value != null && value !== '' ? (
        <Text
          style={[styles.value, {color: tokens.textSecondary}]}
          numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
    </Pressable>
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
  label: {flex: 1, fontSize: 16, fontWeight: '600'},
  value: {maxWidth: '42%', fontSize: 14, textAlign: 'right'},
  chevron: {fontSize: 22, fontWeight: '300'},
});
