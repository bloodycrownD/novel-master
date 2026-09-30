/**
 * 宿主主题 token 统一应用（chat-transcript / rich-document / code-editor 共用）。
 *
 * 语义（2026-08-30 拍板）：条件式写入 + CSS 兜底——字段存在才写对应 CSS
 * 变量，缺省不填充默认色，由消费侧 `var(--x, fallback)` 兜底；
 * `--bg` 的 JS 读取链（mermaid-core）另有 `#fff` 兜底。
 */
import {inferThemeModeFromBg} from './theme-mode';

/** 宿主下发的主题 token 超集（chat 域含 danger/selection；其余域未消费亦容忍）。 */
export type HostTheme = {
  background?: string;
  text?: string;
  textSecondary?: string;
  primary?: string;
  /**
   * primary 的低透明派生（胶囊底色 --primary-muted）。
   * 口径：宿主算色、web 不做颜色计算（capsule/C-orch-1）——原先 code-editor 在
   * web 侧自拼 `primary + '22'`，与 composer-input 的宿主下发口径相反。
   * 可选：chat-transcript / rich-document 不消费，缺省不写入，由 CSS 兜底。
   */
  primaryMuted?: string;
  /**
   * 文本选区底色（`::selection`）。chat-conversation 合成包把它并入本超集
   * （9 键超集 = transcript 7 ∪ composer 6 去重），否则 `::selection` 会
   * 回落 `--primary-muted` 变色。composer-input 旧包的 `applyTheme` 仍直写
   * 并行分支（旧链不动）。
   */
  selection?: string;
  danger?: string;
  surface?: string;
  borderLight?: string;
};

/** 主题字段 → 主 CSS 变量（条件式写入按此表顺序）。 */
const THEME_VARS: Array<{key: keyof HostTheme; cssVar: string}> = [
  {key: 'background', cssVar: '--bg'},
  {key: 'text', cssVar: '--text'},
  {key: 'textSecondary', cssVar: '--text-secondary'},
  {key: 'primary', cssVar: '--primary'},
  {key: 'primaryMuted', cssVar: '--primary-muted'},
  {key: 'selection', cssVar: '--selection'},
  {key: 'danger', cssVar: '--danger'},
  {key: 'surface', cssVar: '--surface'},
  {key: 'borderLight', cssVar: '--border'},
];

export type ApplyHostThemeOptions = {
  /** 字段存在时额外同步写入的派生变量（如 code-editor 的 --editor-*）。 */
  extraVars?: Partial<Record<keyof HostTheme, string[]>>;
};

export function applyHostTheme(
  theme: HostTheme | null | undefined,
  opts: ApplyHostThemeOptions = {},
): void {
  if (!theme) return;
  const root = document.documentElement;
  for (const {key, cssVar} of THEME_VARS) {
    const value = theme[key];
    if (!value) continue;
    root.style.setProperty(cssVar, value);
    for (const extra of opts.extraVars?.[key] ?? []) {
      root.style.setProperty(extra, value);
    }
  }
  // 代码高亮 token 配色：按背景亮度推断 dark|light（init 与 themeUpdate 都走这里），
  // token CSS 写两套静态规则（html[data-nm-mode="dark"] 覆盖），不扩展 HostTheme payload
  if (theme.background) {
    root.dataset.nmMode = inferThemeModeFromBg(theme.background);
  }
}
