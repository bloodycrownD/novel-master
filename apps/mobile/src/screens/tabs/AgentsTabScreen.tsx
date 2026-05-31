/**
 * Agents tab skeleton (list placeholder; editor via stack in M3).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {AppHeader} from '../../components/chrome/AppHeader';
import {useTheme} from '../../theme/ThemeProvider';

export function AgentsTabScreen() {
  const {tokens} = useTheme();

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <AppHeader pageKey="agents" />
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>
        Agent 列表（M3）
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  hint: {padding: 16, textAlign: 'center'},
});
