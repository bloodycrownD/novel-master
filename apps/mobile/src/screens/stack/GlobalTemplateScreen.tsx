/**
 * 全局文件浏览器（profile 入口）：只读物理树视图。
 * 数据源为跨域拼接的 physicalVfs（根 `/`），不提供任何写操作。
 */
import React, {useCallback, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {VfsFileManager} from '../../components/vfs/VfsFileManager';
import type {VfsFileManagerHandle} from '../../components/vfs/VfsFileManager';
import {useRuntime} from '../../hooks/useRuntime';
import {useVfsBackNavigation} from '../../hooks/useVfsBackNavigation';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function GlobalTemplateScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const fileRef = useRef<VfsFileManagerHandle>(null);
  // 返回上翻三件套（header 覆盖/硬件返回/侧滑手势）见 hook 内注释。
  const {syncGestureEnabled} = useVfsBackNavigation(fileRef, navigation);

  const openFile = useCallback(
    (path: string) => {
      navigation.navigate('FileEditor', {
        path,
        scopeKind: 'physical',
      });
    },
    [navigation],
  );

  return (
    <View style={{flex: 1, backgroundColor: tokens.background}}>
      <View style={styles.bannerWrap}>
        <FormSectionCard
          tokens={tokens}
          hint="全库文件只读浏览：全局模板、技能与各项目/会话拼接为统一视图，仅供查看。"
        />
      </View>
      <VfsFileManager
        ref={fileRef}
        // 目录变化时同步侧滑手势开关：根目录开（侧滑退出），子目录关（防误退）。
        onDirectoryChange={syncGestureEnabled}
        // 只读模式下 scope 不参与任何写调用，仅满足 prop 形状。
        scope={{kind: 'global'}}
        vfs={runtime.physicalVfs()}
        rootPath="/"
        readOnly
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
