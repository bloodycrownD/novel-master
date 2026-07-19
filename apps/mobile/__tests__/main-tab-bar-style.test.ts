import {describe, expect, it} from '@jest/globals';
import {lightTheme} from '../src/theme/tokens';
import {
  buildMainTabBarStyle,
  resolveChatTabBarStyle,
} from '../src/navigation/main-tab-bar-style';

describe('resolveChatTabBarStyle / buildMainTabBarStyle', () => {
  const insets = {bottom: 34};

  it('T-N1: conversation → tabBar display none', () => {
    const style = resolveChatTabBarStyle('conversation', lightTheme, insets);
    expect(style).toEqual({display: 'none'});
  });

  it('T-N2: sessions → 恢复完整底栏样式', () => {
    const restored = resolveChatTabBarStyle('sessions', lightTheme, insets);
    const expected = buildMainTabBarStyle(lightTheme, insets);
    expect(restored).toEqual(expected);
    expect(restored.display).not.toBe('none');
    expect(restored.backgroundColor).toBe(lightTheme.tabBarBackground);
    expect(restored.paddingBottom).toBe(34);
    expect(restored.height).toBe(56 + 34);
  });

  it('buildMainTabBarStyle: bottom inset 为 0 时仍保留最小 padding', () => {
    const style = buildMainTabBarStyle(lightTheme, {bottom: 0});
    expect(style.paddingBottom).toBe(8);
    expect(style.height).toBe(56);
  });
});
