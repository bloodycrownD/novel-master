/**
 * tokens → 宿主主题全量映射（9 键超集）：chat-transcript / code-editor /
 * rich-document / composer-input 四宿主共用一份真源，各端只取自己的字段子集。
 *
 * 9 键与 web 侧 `src/web/shared/host-theme.ts` 的 `HOST_THEME_KEYS` 同集——
 * 返回类型取 `Required<HostTheme>`，THEME_VARS 增键时本文件编译即红，不会漏字段。
 * `primaryMuted` 由宿主按 `${primary}22` 派生下发（web 不做颜色计算）。
 */
import type {ThemeTokens} from '@/theme/tokens';
import type {HostTheme} from '@/web/shared/host-theme';

export function hostThemeFromTokens(tokens: ThemeTokens): Required<HostTheme> {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    primaryMuted: `${tokens.primary}22`,
    selection: tokens.selection,
    danger: tokens.danger,
    surface: tokens.surface,
    borderLight: tokens.borderLight,
  };
}
