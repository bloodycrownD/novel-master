/**
 * Theme from KKV `nm-desktop-ui` / key `theme`; sets data-theme on html.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ipcAppUiGet, ipcAppUiSet, ipcShellSetTitleBarTheme, getDesktopBridge } from "../ipc/client";

export type ThemeMode = "light" | "dark";

export interface ThemeContextValue {
  mode: ThemeMode;
  loaded: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
  toggleMode: () => Promise<void>;
}

const THEME_KEY = "theme";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ipcAppUiGet(THEME_KEY)
      .then((result) => {
        if (cancelled) return;
        const raw = result.ok ? result.data : undefined;
        if (raw === "dark" || raw === "light") {
          setModeState(raw);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    try {
      if (getDesktopBridge().customTitleBar) {
        void ipcShellSetTitleBarTheme(mode).catch(() => undefined);
      }
    } catch {
      // Browser preview — no preload bridge.
    }
  }, [mode]);

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next);
    await ipcAppUiSet(THEME_KEY, next);
  }, []);

  const toggleMode = useCallback(async () => {
    await setMode(mode === "light" ? "dark" : "light");
  }, [mode, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, loaded, setMode, toggleMode }),
    [mode, loaded, setMode, toggleMode],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
