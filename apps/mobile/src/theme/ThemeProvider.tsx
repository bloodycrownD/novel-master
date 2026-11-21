/**
 * Theme from {@link AppUiPreferences} (`theme` key), default light until loaded.
 */
import React, {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import {useColorScheme} from 'react-native';
import {useNovelMaster} from '../runtime/novel-master-context';
import {APP_UI_KEY_THEME} from '../storage/app-ui-keys';
import {Tokens, type ThemeMode, type ThemeTokens} from './tokens';

interface ThemeContextValue {
  mode: ThemeMode;
  tokens: ThemeTokens;
  loaded: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
  toggleMode: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({children}: {children: ReactNode}) {
  const system = useColorScheme();
  const {appUi} = useNovelMaster();
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!appUi) {
      setLoaded(false);
      return;
    }
    let cancelled = false;
    const themePref = appUi.get(APP_UI_KEY_THEME);
    themePref
      .then(raw => {
        if (cancelled) {
          return;
        }
        // 读取失败（错误通道迁移四期：Result）与旧 catch 同款按系统色兜底。
        const value = raw.ok ? raw.value : undefined;
        if (value === 'dark' || value === 'light') {
          setModeState(value);
        } else if (system === 'dark') {
          setModeState('dark');
        } else {
          setModeState('light');
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setModeState(system === 'dark' ? 'dark' : 'light');
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appUi, system]);

  const setMode = useCallback(
    async (next: ThemeMode) => {
      setModeState(next);
      if (appUi) {
        try {
          await appUi.set(APP_UI_KEY_THEME, next);
        } catch (error) {
          // fire-and-forget 场景（如 void toggleMode()）下不冒泡成 unhandled rejection。
          console.warn('[ThemeProvider] persist theme mode failed:', error);
        }
      }
    },
    [appUi],
  );

  const toggleMode = useCallback(async () => {
    await setMode(mode === 'light' ? 'dark' : 'light');
  }, [mode, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      tokens: Tokens.forMode(mode),
      loaded,
      setMode,
      toggleMode,
    }),
    [mode, loaded, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // nm-throw: keep — UI 错误边界语义：hook 契约护栏，渲染期抛给错误边界
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
