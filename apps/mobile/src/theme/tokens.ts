/**
 * Light/dark theme tokens (aligned with prototype CSS variables).
 */
export type ThemeMode = 'light' | 'dark';

export interface ThemeTokens {
  background: string;
  bgSecondary: string;
  surface: string;
  surfaceElevated: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderLight: string;
  primary: string;
  /**
   * 文本选中高亮（柔和 tint，非 primary 原色整块）。
   * Composer 等输入框 `selectionColor` 使用。
   */
  selection: string;
  headerBackground: string;
  tabBarBackground: string;
  tabBarActive: string;
  tabBarInactive: string;
  success: string;
  warning: string;
  warningMuted: string;
  danger: string;
}

export const lightTheme: ThemeTokens = {
  background: '#F2F2F7',
  bgSecondary: '#E5E5EA',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  text: '#000000',
  textSecondary: '#8E8E93',
  textTertiary: '#C7C7CC',
  border: '#C6C6C8',
  borderLight: '#E5E5EA',
  primary: '#007AFF',
  selection: '#007AFF55',
  headerBackground: '#FFFFFF',
  tabBarBackground: '#FFFFFF',
  tabBarActive: '#007AFF',
  tabBarInactive: '#8E8E93',
  success: '#34C759',
  warning: '#FF9500',
  warningMuted: 'rgba(255, 149, 0, 0.12)',
  danger: '#FF3B30',
};

export const darkTheme: ThemeTokens = {
  background: '#000000',
  bgSecondary: '#1C1C1E',
  surface: '#1C1C1E',
  surfaceElevated: '#2C2C2E',
  text: '#FFFFFF',
  textSecondary: '#98989D',
  textTertiary: '#48484A',
  border: '#38383A',
  borderLight: '#2C2C2E',
  primary: '#0A84FF',
  selection: '#0A84FF55',
  headerBackground: '#1C1C1E',
  tabBarBackground: '#1C1C1E',
  tabBarActive: '#0A84FF',
  tabBarInactive: '#98989D',
  success: '#30D158',
  warning: '#FF9F0A',
  warningMuted: 'rgba(255, 159, 10, 0.18)',
  danger: '#FF453A',
};

export function tokensForMode(mode: ThemeMode): ThemeTokens {
  return mode === 'dark' ? darkTheme : lightTheme;
}
