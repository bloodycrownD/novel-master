/**
 * Theme from {@link AppUiPreferences} (`theme` key), default light until loaded.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {useColorScheme} from 'react-native';
import {useNovelMaster} from '../runtime/novel-master-context';
import {appUiKeys} from '../storage/app-ui-prefs';
import {tokensForMode, type ThemeMode, type ThemeTokens} from './tokens';

export interface ThemeContextValue {
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
    appUi
      .get(appUiKeys.theme)
      .then(raw => {
        if (cancelled) {
          return;
        }
        if (raw === 'dark' || raw === 'light') {
          setModeState(raw);
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
        await appUi.set(appUiKeys.theme, next);
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
      tokens: tokensForMode(mode),
      loaded,
      setMode,
      toggleMode,
    }),
    [mode, loaded, setMode, toggleMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
