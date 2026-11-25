/**
 * Read-only status card for settings lists (FormSectionCard shell, not a menu row).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import type {ThemeTokens} from '@/theme/tokens';

type ProfileStatusMetric = {
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

export function ProfileStatusCard({title, hint, message, metrics, notice, noticeTone = 'muted', tokens}: Props) {
    // 指标行优先；无指标但给了 message 出提示行；两者皆无不渲染
    let statusNode: React.ReactNode = null;
    if (metrics != null && metrics.length > 0) {
        statusNode = (
            <View style={styles.metricRow}>
                {metrics.map(metric => {
                    let valueColor: string;
                    switch (metric.tone) {
                        case 'warning': {
                            valueColor = tokens.warning;
                            break;
                        }
                        case 'success': {
                            valueColor = tokens.success;
                            break;
                        }
                        default: {
                            valueColor = tokens.text;
                        }
                    }
                    return (
                        <View key={metric.label} style={[styles.metric, {backgroundColor: tokens.bgSecondary}]}>
                            <Text style={[styles.metricLabel, {color: tokens.textSecondary}]}>{metric.label}</Text>
                            <Text style={[styles.metricValue, {color: valueColor}]} numberOfLines={1}>
                                {metric.value}
                            </Text>
                        </View>
                    );
                })}
            </View>
        );
    } else if (message) {
        statusNode = <Text style={[styles.message, {color: tokens.textSecondary}]}>{message}</Text>;
    }

    return (
        <FormSectionCard title={title} hint={hint} tokens={tokens}>
            {statusNode}
            {notice ? (
                <Text
                    style={[
                        styles.notice,
                        {
                            color: noticeTone === 'warning' ? tokens.warning : tokens.textSecondary,
                            backgroundColor: noticeTone === 'warning' ? tokens.warningMuted : tokens.bgSecondary,
                        },
                    ]}
                >
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
