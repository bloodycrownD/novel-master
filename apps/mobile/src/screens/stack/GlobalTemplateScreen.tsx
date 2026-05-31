/**
 * Global template VFS browser (profile → 全局模板).
 */
import React, {useCallback} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {VfsFileManager} from '../../components/vfs/VfsFileManager';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function GlobalTemplateScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();

  const openFile = useCallback(
    (path: string) => {
      navigation.navigate('FileEditor', {
        path,
        scopeKind: 'global',
      });
    },
    [navigation],
  );

  return (
    <View style={{flex: 1, backgroundColor: tokens.background}}>
      <View style={[styles.banner, {backgroundColor: tokens.surface}]}>
        <Text style={[styles.bannerText, {color: tokens.textSecondary}]}>
          全应用共享；项目可通过「从上级同步」拉取此处模板。
        </Text>
      </View>
      <VfsFileManager
        scope={{kind: 'global'}}
        vfs={runtime.globalVfs()}
        worktree={runtime.worktree({kind: 'global'})}
        rootPath="/template"
        onOpenFile={openFile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    padding: 12,
    borderRadius: 8,
  },
  bannerText: {fontSize: 13, lineHeight: 18},
});
