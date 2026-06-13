/**
 * 表单加载失败时的全屏错误卡片。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';

type Action = {
  label: string;
  onPress: () => void;
  danger?: boolean;
};

type Props = {
  tokens: ThemeTokens;
  title: string;
  message: string;
  primaryAction?: Action;
  secondaryAction?: Action;
};

export function FormErrorCard({
  tokens,
  title,
  message,
  primaryAction,
  secondaryAction,
}: Props) {
  return (
    <View
      style={[
        styles.card,
        {borderColor: tokens.border, backgroundColor: tokens.surface},
      ]}>
      <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
      <Text style={[styles.message, {color: tokens.textSecondary}]}>
        {message}
      </Text>
      <View style={styles.actions}>
        {secondaryAction ? (
          <Pressable onPress={secondaryAction.onPress}>
            <Text style={{color: tokens.primary, fontSize: 14, fontWeight: '600'}}>
              {secondaryAction.label}
            </Text>
          </Pressable>
        ) : null}
        {primaryAction ? (
          <Pressable onPress={primaryAction.onPress}>
            <Text
              style={{
                color: primaryAction.danger ? tokens.danger : tokens.primary,
                fontSize: 14,
                fontWeight: '600',
              }}>
              {primaryAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: 16,
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 10,
  },
  title: {fontSize: 15, fontWeight: '600', lineHeight: 21},
  message: {fontSize: 13, lineHeight: 19},
  actions: {flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4},
});
