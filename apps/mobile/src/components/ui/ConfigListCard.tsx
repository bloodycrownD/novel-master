/**
 * Standard elevated row for config stack list screens.
 */
import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {ElevatedCard} from './ElevatedCard';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  tokens: ThemeTokens;
  selected?: boolean;
  onPress: () => void;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  onMenuPress?: () => void;
  showChevron?: boolean;
};

export function ConfigListCard({
  tokens,
  selected,
  onPress,
  leading,
  title,
  subtitle,
  badge,
  onMenuPress,
  showChevron = true,
}: Props) {
  return (
    <ElevatedCard tokens={tokens} selected={selected} onPress={onPress}>
      {leading}
      <View style={styles.info}>
        <Text style={[styles.title, {color: tokens.text}]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle != null ? (
          <Text
            style={[styles.subtitle, {color: tokens.textSecondary}]}
            numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge != null ? (
        <View style={[styles.badge, {backgroundColor: tokens.primary}]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {onMenuPress != null ? (
        <Pressable
          hitSlop={8}
          onPress={e => {
            e.stopPropagation?.();
            onMenuPress();
          }}>
          <Text style={[styles.menuDots, {color: tokens.textSecondary}]}>⋮</Text>
        </Pressable>
      ) : null}
      {showChevron ? (
        <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
      ) : null}
    </ElevatedCard>
  );
}

const styles = StyleSheet.create({
  info: {flex: 1, minWidth: 0, gap: 4},
  title: {fontSize: 16, fontWeight: '600'},
  subtitle: {fontSize: 13, lineHeight: 18},
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {color: '#FFFFFF', fontSize: 12, fontWeight: '600'},
  menuDots: {fontSize: 18, paddingHorizontal: 4},
  chevron: {fontSize: 22, fontWeight: '300'},
});
