/**
 * Read-only status card for settings lists (FormSectionCard shell, not a menu row).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FormSectionCard} from '../form/FormSectionCard';
import type {ThemeTokens} from '../../theme/tokens';

export type ProfileStatusMetric = {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'success';
};

type Props = {
  title: string;
  hint?: string;
  message?: string;
  metrics?: ProfileStatusMetric[];
  notice?: string;
  noticeTone?: 'warning' | 'muted';
  tokens: ThemeTokens;
};

function metricColor(
  tone: ProfileStatusMetric['tone'] | undefined,
  tokens: ThemeTokens,
): string {
  if (tone === 'warning') {
    return tokens.warning;
  }
  if (tone === 'success') {
    return tokens.success;
  }
  return tokens.text;
}

export function ProfileStatusCard({
  title,
  hint,
  message,
  metrics,
  notice,
  noticeTone = 'muted',
  tokens,
}: Props) {
  return (
    <FormSectionCard title={title} hint={hint} tokens={tokens}>
      {metrics != null && metrics.length > 0 ? (
        <View style={styles.metricRow}>
          {metrics.map(metric => (
            <View
              key={metric.label}
              style={[styles.metric, {backgroundColor: tokens.bgSecondary}]}>
              <Text style={[styles.metricLabel, {color: tokens.textSecondary}]}>
                {metric.label}
              </Text>
              <Text
                style={[
                  styles.metricValue,
                  {color: metricColor(metric.tone, tokens)},
                ]}
                numberOfLines={1}>
                {metric.value}
              </Text>
            </View>
          ))}
        </View>
      ) : message ? (
        <Text style={[styles.message, {color: tokens.textSecondary}]}>
          {message}
        </Text>
      ) : null}
      {notice ? (
        <Text
          style={[
            styles.notice,
            {
              color:
                noticeTone === 'warning'
                  ? tokens.warning
                  : tokens.textSecondary,
              backgroundColor:
                noticeTone === 'warning' ? tokens.warningMuted : tokens.bgSecondary,
            },
          ]}>
          {notice}
        </Text>
      ) : null}
    </FormSectionCard>
  );
}

const styles = StyleSheet.create({
  metricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metric: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  metricValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  notice: {
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 18,
  },
});
