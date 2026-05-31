/**
 * Light/dark theme tokens (aligned with prototype CSS variables).
 */
export type ThemeMode = 'light' | 'dark';

export interface ThemeTokens {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
  headerBackground: string;
  tabBarBackground: string;
  tabBarActive: string;
  tabBarInactive: string;
  danger: string;
}

export const lightTheme: ThemeTokens = {
  background: '#f5f5f5',
  surface: '#ffffff',
  text: '#1a1a1a',
  textSecondary: '#666666',
  border: '#e0e0e0',
  primary: '#2563eb',
  headerBackground: '#ffffff',
  tabBarBackground: '#ffffff',
  tabBarActive: '#2563eb',
  tabBarInactive: '#888888',
  danger: '#dc2626',
};

export const darkTheme: ThemeTokens = {
  background: '#121212',
  surface: '#1e1e1e',
  text: '#f0f0f0',
  textSecondary: '#aaaaaa',
  border: '#333333',
  primary: '#60a5fa',
  headerBackground: '#1e1e1e',
  tabBarBackground: '#1e1e1e',
  tabBarActive: '#60a5fa',
  tabBarInactive: '#888888',
  danger: '#f87171',
};

export function tokensForMode(mode: ThemeMode): ThemeTokens {
  return mode === 'dark' ? darkTheme : lightTheme;
}
