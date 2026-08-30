/**
 * VFS 文件浏览器「返回上翻」三件套：header 覆盖返回、硬件返回拦截、
 * iOS 侧滑手势开关。子目录时返回逐级上翻，根目录时才真正退出页面。
 */
import {useCallback, useEffect, type RefObject} from 'react';
import {BackHandler} from 'react-native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {VfsFileManagerHandle} from '@/components/vfs/VfsFileManager';
import {useHeaderContext} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function useVfsBackNavigation(
  fileRef: RefObject<VfsFileManagerHandle | null>,
  navigation: Nav,
  options?: {title?: string},
) {
  const {setStackOverride} = useHeaderContext();

  // 系统返回（header/侧滑/硬件返回）在子目录时逐级上翻而非退出页面；
  // 根目录时才真正退出。
  const goUpOrExit = useCallback(() => {
    if (fileRef.current?.canGoUp()) {
      fileRef.current.goUp();
    } else {
      navigation.goBack();
    }
  }, [fileRef, navigation]);

  useEffect(() => {
    setStackOverride({
      ...(options?.title != null ? {title: options.title} : {}),
      onBack: goUpOrExit,
    });
    return () => setStackOverride(undefined);
  }, [setStackOverride, goUpOrExit, options?.title]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // 仅在本屏聚焦时拦截：BackHandler 是全局的，FileEditor 等上层屏幕
      // 在栈顶时若不判聚焦，详情页的返回/侧滑会被本屏吞成目录上翻，
      // 详情屏卡住退不出（安卓侧滑返回走 BackHandler 链）。
      if (!navigation.isFocused()) {
        return false;
      }
      if (fileRef.current?.canGoUp()) {
        fileRef.current.goUp();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [fileRef, navigation]);

  // iOS 侧滑不用 beforeRemove 拦截：手势发起的 pop 在原生侧转换已开始，
  // JS preventDefault 拦不住退出，还会破坏后续手势（native-stack 已知
  // 行为）。改为动态开关手势：根目录开（侧滑=原生退出，零拦截），
  // 子目录关（侧滑无效，防误退；上翻走 header 返回箭头与硬件返回）。
  const syncGestureEnabled = useCallback(() => {
    navigation.setOptions({
      gestureEnabled: !fileRef.current?.canGoUp(),
    });
  }, [fileRef, navigation]);
  useEffect(() => {
    syncGestureEnabled();
  }, [syncGestureEnabled]);

  return {goUpOrExit, syncGestureEnabled};
}
