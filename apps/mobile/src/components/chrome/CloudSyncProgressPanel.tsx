/**
 * 云同步进度展示（全屏页内居中卡片）。
 */
import React, {useEffect, useRef} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {ThemeTokens} from '../../theme/tokens';
import type {CloudSyncProgressUiState} from '../../services/cloud-sync-progress-ui';

type Props = {
  title: string;
  state: CloudSyncProgressUiState | null;
  tokens: ThemeTokens;
};

export function CloudSyncProgressPanel({title, state, tokens}: Props) {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (state?.indeterminate !== true) {
      pulse.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.95,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state?.indeterminate, pulse]);

  const progress = state?.progress ?? 0;
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const phaseLabel = state?.label ?? '正在同步…';

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: tokens.surface,
            borderColor: tokens.borderLight,
          },
        ]}>
        <ActivityIndicator color={tokens.primary} size="large" />
        <Text style={[styles.title, {color: tokens.text}]}>{title}</Text>
        <Text style={[styles.phase, {color: tokens.textSecondary}]}>
          {phaseLabel}
        </Text>
        <View
          style={[styles.track, {backgroundColor: tokens.bgSecondary}]}
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: 100,
            now: percent,
          }}>
          {state?.indeterminate === true ? (
            <Animated.View
              style={[
                styles.indeterminateFill,
                {
                  backgroundColor: tokens.primary,
                  opacity: pulse,
                },
              ]}
            />
          ) : (
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: tokens.primary,
                  width: `${percent}%`,
                },
              ]}
            />
          )}
        </View>
        <Text style={[styles.percent, {color: tokens.textSecondary}]}>
          {state?.indeterminate === true ? '传输中…' : `${percent}%`}
        </Text>
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          请勿关闭应用，大文件可能需要数分钟
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 4,
  },
  phase: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  track: {
    alignSelf: 'stretch',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 8,
  },
  fill: {
    height: '100%',
    borderRadius: 5,
  },
  indeterminateFill: {
    height: '100%',
    width: '45%',
    borderRadius: 5,
  },
  percent: {
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
});
