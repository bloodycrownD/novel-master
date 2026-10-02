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

/**
 * 主题 token 键集（**由 `THEME_VARS` 派生，全仓唯一真源**）。
 *
 * 合成包 chat-conversation 的两处「9 键超集」清单——web 侧
 * `chat-conversation/webview/model.ts` 的 `CONVERSATION_THEME_KEYS` 与 RN 侧
 * `components/chat/ChatConversationBridge.ts` 的同名常量——都直接 import 本导出，
 * 不再各抄一份。原先三份手抄之间零约束，宿主加第 10 个 token 时三处全不红、
 * 只在某天 `::selection` 那样漏写才由 UI 变色暴露；现在改 `THEME_VARS` 一处即全跟随。
 *
 * 顺序即 `THEME_VARS` 的写入顺序（条件式写入按此表顺序，见 `applyHostTheme`），
 * 两个消费端的双端同序断言依赖这一点。
 */
export const HOST_THEME_KEYS: readonly (keyof HostTheme)[] = THEME_VARS.map(
  entry => entry.key,
);

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
