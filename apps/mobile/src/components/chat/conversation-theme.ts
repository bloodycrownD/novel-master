/**
 * Conversation 主题 9 键映射（chat-webview-unify Step 5 引入形态；
 * composer-native-2026-10 Step 5 抽为独立模块供转录宿主与原生 composer 共用）。
 *
 * 独立成模块的理由：`ChatConversationPanel` 的集成测试整体 mock 掉
 * `ChatConversationWebView`，放在宿主文件里会让面板侧 import 落到 mock 上；
 * 主题映射是转录 webview 与 `NativeChatComposer` 的**共同真源**，两处必须
 * 同值（同一份 tokens 经同一映射），抽出来正好钉死这一点。
 *
 * 9 键超集：transcript 7 键 ∪ composer 6 键去重，一次 `themeUpdate` 全文档生效。
 * `primaryMuted` 由宿主算（`${primary}22`，web 不做颜色计算）；`selection` 直接取
 * tokens（缺了 `::selection` 会回落 `--primary-muted` 变色）。
 */
import type {ConversationTheme} from './ChatConversationBridge';

export function conversationThemeFromTokens(tokens: {
  background: string;
  text: string;
  textSecondary: string;
  primary: string;
  selection: string;
  danger: string;
  surface: string;
  borderLight: string;
}): ConversationTheme {
  const theme: ConversationTheme = {
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
  return theme;
}
