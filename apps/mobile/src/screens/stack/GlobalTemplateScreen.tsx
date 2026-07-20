/**
 * Global template VFS browser (profile → 全局模板).
 */
import React, {useCallback} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {FormSectionCard} from '../../components/form/FormSectionCard';
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
      <View style={styles.bannerWrap}>
        <FormSectionCard
          tokens={tokens}
          hint="全应用共享；项目可通过「从上级同步」拉取此处工作区内容。"
        />
      </View>
      <VfsFileManager
        scope={{kind: 'global'}}
        vfs={runtime.globalVfs()}
        workplace={runtime.worktree({kind: 'global'})}
        rootPath="/"
        onOpenFile={openFile}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bannerWrap: {
    marginHorizontal: 5,
    marginTop: 8,
    marginBottom: 4,
  },
});
