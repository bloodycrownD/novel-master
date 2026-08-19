/**
 * Mermaid 全屏查看器样式常量（单源；build-webview.mjs 注入两包 app.css）。
 * 选择器不带 `.bubble.rich` 前缀 → 不进 buildRichContentCssRules，走独立注入位。
 * 主题：背景 var(--bg)、按钮 var(--surface)/var(--text)
 * （两管线 bridge 的 applyTheme 都写这些变量，深色自动协调）。
 * z-index 对齐 menu-backdrop（9998）/ context-menu（9999）量级。
 */
export const MERMAID_FULLSCREEN_CSS = `
  /* 全屏态禁滚动（照 body.menu-open 先例；#scroller/#doc 才是滚动容器） */
  body.mermaid-viewer-open { overflow: hidden; }
  body.mermaid-viewer-open #scroller,
  body.mermaid-viewer-open #doc { overflow: hidden; }
  .mermaid-fullscreen-backdrop {
    position: fixed; inset: 0; z-index: 9998;
    background: var(--bg, #fff);
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  }
  .mermaid-fullscreen-stage {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden; touch-action: none;
  }
  .mermaid-fullscreen-viewport {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    transform-origin: center center; will-change: transform;
  }
  .mermaid-fullscreen-viewport svg { max-width: 100%; max-height: 100%; }
  .mermaid-fullscreen-close {
    position: fixed; top: 14px; right: 14px; z-index: 9999;
    width: 36px; height: 36px;
    border: 1px solid var(--border, #e5e5ea); border-radius: 18px;
    background: var(--surface, #f2f2f7); color: var(--text, #111);
    font-size: 18px; line-height: 1; text-align: center;
    cursor: pointer; -webkit-tap-highlight-color: transparent;
  }
`.trim();
