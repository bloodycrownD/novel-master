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
      console.log(
        `[swipe-debug] Browser hardwareBack canGoUp=${fileRef.current?.canGoUp() ?? '?'} @${Date.now()}`,
      );
      if (fileRef.current?.canGoUp()) {
        fileRef.current.goUp();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);
  // [swipe-debug] 临时诊断：focus / beforeRemove 事件流（核对侧滑产生的 POP
  // 是否到达浏览器、是否连坐退出），确认后移除。
  useEffect(() => {
    const focusSub = navigation.addListener('focus', () =>
      console.log(`[swipe-debug] Browser focus @${Date.now()}`),
    );
    const removeSub = navigation.addListener('beforeRemove', e =>
      console.log(
        `[swipe-debug] Browser beforeRemove type=${e.data.action.type} canGoUp=${fileRef.current?.canGoUp() ?? '?'} @${Date.now()}`,
      ),
    );
    return () => {
      focusSub();
      removeSub();
    };
  }, [navigation]);
  // iOS 侧滑不用 beforeRemove 拦截：手势发起的 pop 在原生侧转换已开始，
  // JS preventDefault 拦不住退出，还会破坏后续手势（native-stack 已知
  // 行为）。改为动态开关手势：根目录开（侧滑=原生退出，零拦截），
  // 子目录关（侧滑无效，防误退；上翻走 header 返回箭头与硬件返回）。
  const syncGestureEnabled = useCallback(() => {
    const canGoUp = fileRef.current?.canGoUp() ?? false;
    console.log(
      `[swipe-debug] Browser setOptions gestureEnabled=${!canGoUp} @${Date.now()}`,
    );
    navigation.setOptions({
      gestureEnabled: !canGoUp,
    });
  }, [navigation]);
  useEffect(() => {
    syncGestureEnabled();
  }, [syncGestureEnabled]);

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
