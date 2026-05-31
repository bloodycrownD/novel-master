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

export interface HeaderOverride {
  title?: string;
  showBack?: boolean;
  showMenu?: boolean;
  onBack?: () => void;
  onMenu?: () => void;
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
