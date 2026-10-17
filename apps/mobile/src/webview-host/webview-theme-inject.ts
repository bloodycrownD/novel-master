/**
 * 首帧主题预注入脚本构建（白闪 B 通道）——rich-document / code-editor /
 * chat-transcript 三宿主共用单源（fix-D 2026-10-18 自两份同构镜像抽取）。
 *
 * 语义：文档开始加载前先把 `--bg` 写成主题背景色，堵住各包 CSS 兜底
 * `var(--bg,#fff)` 的暗色白窗。正文与其余主题变量要等 web 侧 ready→init
 * 的 `applyHostTheme` 才渲染、不参与首帧，故只注入 `--bg`；先写后由
 * `applyHostTheme` 同节点同属性重写同值，覆盖无冲突。
 *
 * `'--bg'` 字面量是 `src/web/shared/host-theme.ts` 的 `THEME_VARS`
 * （background→--bg）在 RN 侧的镜像——映射表是 cssVar 的唯一真源，此处手写
 * 不会随表变化报错，改表时必须同步核对（RULE #17：取 `tokens.background`，
 * 不得用 `surface`）。
 *
 * 防御（Android 时机弱于 iOS）：Android 侧 beforeContentLoaded 落在
 * onPageStarted 上异步 evaluateJavascript，`documentElement` 可能尚未就绪；
 * null 防护 + try/catch 静默失败（A 的 WebView 控件底色兜底）。IIFE 包裹：
 * 注入面按表达式求值，返回值直接丢弃。
 *
 * fix-D（2026-10-18）后首帧主通道是 C′（index.html head 内联 bootstrap +
 * 宿主 URI `#bg=` 参数，解析期同步执行、零竞态）；本函数是 iOS 主通道 +
 * Android 双保险（B 在 Android 输给首绘，由 C′ 兜确定性）。
 */
export function buildThemeInjectScript(background: string): string {
  return `(function(){try{var el=document.documentElement;if(!el){return;}el.style.setProperty('--bg', ${JSON.stringify(background)});}catch(e){}})();`;
}
