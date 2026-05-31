/**
 * FIFO retention hint (UI only until Core implements eviction).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  retention: number;
};

export function CheckpointFifoBanner({retention}: Props) {
  const {tokens} = useTheme();
  const n = Math.max(1, Math.round(retention));

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: tokens.warningMuted,
          borderColor: tokens.warning,
        },
      ]}>
      <Text style={[styles.text, {color: tokens.warning}]}>
        最多保留 {n} 个检查点，超出后最旧的将被移除（淘汰逻辑由 Core 后续实现）
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {fontSize: 13, lineHeight: 18},
});
