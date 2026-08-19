/**
 * 全局文件浏览器（profile 入口）：只读物理树视图。
 * 数据源为跨域拼接的 physicalVfs（根 `/`），不提供任何写操作。
 */
import React, {useCallback, useEffect, useRef} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {VfsFileManager} from '../../components/vfs/VfsFileManager';
import type {VfsFileManagerHandle} from '../../components/vfs/VfsFileManager';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';
import {shouldInterceptBackRemove} from './global-template-back';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function GlobalTemplateScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const {setStackOverride} = useHeaderContext();
  const fileRef = useRef<VfsFileManagerHandle>(null);

  // 系统返回（header/侧滑/硬件返回）在子目录时逐级上翻而非退出页面；
  // 根目录时才真正退出。
  const goUpOrExit = useCallback(() => {
    if (fileRef.current?.canGoUp()) {
      fileRef.current.goUp();
    } else {
      navigation.goBack();
    }
  }, [navigation]);
  useEffect(() => {
    setStackOverride({onBack: goUpOrExit});
    return () => setStackOverride(undefined);
  }, [setStackOverride, goUpOrExit]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (fileRef.current?.canGoUp()) {
        fileRef.current.goUp();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    // iOS 侧滑手势不走 BackHandler，会直接触发路由 pop；在此拦截
    // 并转为逐级上翻。仅拦截 POP 类返回动作——RESET/POP_TO_TOP 等
    // 清栈导航（如登出）必须放行，不能被吞成上翻。goUpOrExit 中
    // goBack 仅在根目录调用，不会被本拦截器因 canGoUp 为 false 而
    // 自我阻断。
    const sub = navigation.addListener('beforeRemove', e => {
      const handle = fileRef.current;
      if (
        handle == null ||
        !shouldInterceptBackRemove({
          actionType: e.data.action.type,
          canGoUp: handle.canGoUp(),
        })
      ) {
        return;
      }
      e.preventDefault();
      handle.goUp();
    });
    return sub;
  }, [navigation]);

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
