/**
 * Dynamic header overrides (chat subviews, stack dynamic titles).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {ChatHeaderContext} from './types';
import {useRoute} from '@react-navigation/native';

export interface HeaderOverride {
  title?: string;
  showBack?: boolean;
  showMenu?: boolean;
  /** 自定义菜单 icon（如技能面板用列表管理 icon 区别于菜单汉堡）。 */
  menuIcon?: ReactNode;
  onBack?: () => void;
  onMenu?: () => void;
  /**
   * 归属屏的 route key（useStackOverrideSetter 自动附加）：AppHeader 只在
   * 自己屏的 key 匹配时应用 override。转场动画期间两个屏的 header 同时
   * 可见，若不过滤会出现「问号/标题同时渲染在两个页面」的闪烁。
   * 缺省（旧调用方）维持全局语义，不参与过滤。
   */
  ownerRouteKey?: string;
}

interface HeaderContextValue {
  chat: ChatHeaderContext;
  setChat: (patch: Partial<ChatHeaderContext>) => void;
  stackOverride: HeaderOverride | undefined;
  setStackOverride: (override: HeaderOverride | undefined) => void;
}

const HeaderCtx = createContext<HeaderContextValue | undefined>(undefined);

export function HeaderProvider({children}: {children: ReactNode}) {
  const [chat, setChatState] = useState<ChatHeaderContext>({
    chatSubview: 'sessions',
    sessionListPanel: 'sessions',
  });
  const [stackOverride, setStackOverride] = useState<HeaderOverride>();

  const setChat = useCallback((patch: Partial<ChatHeaderContext>) => {
    setChatState(prev => ({...prev, ...patch}));
  }, []);

  const value = useMemo(
    () => ({chat, setChat, stackOverride, setStackOverride}),
    [chat, setChat, stackOverride],
  );

  return <HeaderCtx.Provider value={value}>{children}</HeaderCtx.Provider>;
}

export function useHeaderContext(): HeaderContextValue {
  const ctx = useContext(HeaderCtx);
  if (!ctx) {
    throw new Error('useHeaderContext requires HeaderProvider');
  }
  return ctx;
}

/**
 * 屏级 stack override setter：自动附加当前屏的 route key 为 ownerRouteKey，
 * AppHeader 仅在归属屏应用（转场期间不再泄漏到相邻屏）。屏组件内使用。
 */
export function useStackOverrideSetter() {
  const {setStackOverride} = useHeaderContext();
  const route = useRoute();
  return useCallback(
    (override: HeaderOverride | undefined) => {
      setStackOverride(
        override == null ? undefined : {...override, ownerRouteKey: route.key},
      );
    },
    [setStackOverride, route.key],
  );
}
