/**
 * VFS file manager placeholder (M1 empty list; wired in M2).
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

export function VfsFileManager() {
  const {tokens} = useTheme();
  return (
    <View style={styles.root}>
      <Text style={{color: tokens.textSecondary}}>
        会话工作区文件列表（M2）
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24},
});
