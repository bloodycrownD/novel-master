import {state} from '../state/state';
import type {ToolCallRow} from '../state/state';
import {post} from '../bridge';
import {closeContextMenu} from '../menu/menu';
import {readableToolResult} from './tool-logic';
import {renderRows} from './row-logic';
import {requestLoadOlder} from '../scroll/scroll';

/**
 * #rows 点击：折叠开关、打开工具文件、加载更早等。
 * data-action 未命中时落到 <a> 链接拦截分支（chat-link-file-nav）。
 */
export function onRowsClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target || !target.closest) return;
  const actionEl = target.closest('[data-action]');
  if (!actionEl) {
    onAnchorClick(target, event);
    return;
  }
  const action = actionEl.getAttribute('data-action');
  if (action === 'close-menu') {
    closeContextMenu(true);
    return;
  }
  if (action === 'menu-action') {
    const messageId = actionEl.getAttribute('data-message-id');
    const menuAction = actionEl.getAttribute('data-menu-action');
    closeContextMenu(true);
    if (messageId && menuAction) {
      post('messageMenuAction', {messageId: messageId, action: menuAction});
    }
    return;
  }
  if (action === 'toggle-thinking') {
    const key = actionEl.getAttribute('data-thinking-key');
    if (key) {
      state.thinkingExpanded[key] = !state.thinkingExpanded[key];
      renderRows();
    }
    return;
  }
  if (action === 'toggle-tool-group') {
    const tgKey = actionEl.getAttribute('data-tool-group-key');
    if (tgKey) {
      state.toolGroupExpanded[tgKey] = !state.toolGroupExpanded[tgKey];
      renderRows();
    }
    return;
  }
  if (action === 'toggle-attach-group') {
    const agKey = actionEl.getAttribute('data-attach-group-key');
    if (agKey) {
      state.attachGroupExpanded[agKey] = !state.attachGroupExpanded[agKey];
      renderRows();
    }
    return;
  }
  if (action === 'open-tool-file') {
    const path = actionEl.getAttribute('data-path');
    if (path) post('openToolFile', {path: path});
    return;
  }
  if (action === 'open-subagent-session') {
    const sessionId = actionEl.getAttribute('data-session-id');
    if (sessionId) post('openSubagentSession', {sessionId: sessionId});
    return;
  }
  if (action === 'open-skill') {
    const domain = actionEl.getAttribute('data-domain');
    const projectId = actionEl.getAttribute('data-project-id');
    const name = actionEl.getAttribute('data-name');
    if (name && domain) {
      post('openSkillDetail', {
        domain: domain,
        name: name,
        ...(projectId != null ? {projectId: projectId} : {}),
      });
    }
    return;
  }
  if (action === 'open-tool-result') {
    // 正文不进 DOM 属性（可达数百 KB）：按 toolUseId 从 state.rows 反查，
    // 一次 post 上抛宿主阅读页。可读正文（content 空串回落 summary）判定
    // 单源在 readableToolResult——与 ToolGroup 的可点判定共用，口径不分叉。
    // 入参（input）同样走反查：curl 的 body/headers、fs 的 from→to 只在
    // 摘要一行里看不全，阅读页要能同时看到「发了什么」与「回了什么」。
    // 用原文 pretty JSON（2 空格缩进），不是格子预览形态——formatToolUsePreviewJson
    // 是卡片格子的截断摘要形态，放进阅读页会被误当正文。
    const toolUseId = actionEl.getAttribute('data-tool-use-id');
    if (toolUseId) {
      const row = findToolRowByUseId(toolUseId);
      if (row != null) {
        const content = readableToolResult(row);
        if (content != null) {
          post('openToolResult', {
            title: row.name || '工具结果',
            content: content,
            ...(row.input != null
              ? {inputJson: JSON.stringify(row.input, null, 2)}
              : {}),
          });
        }
      }
    }
    return;
  }
  if (action === 'load-older') {
    requestLoadOlder();
  }
}

/** 按 toolUseId 在 state.rows 的 tools 里反查工具行（结果阅读分支专用）。 */
function findToolRowByUseId(toolUseId: string): ToolCallRow | null {
  for (const row of state.rows) {
    if (row.kind !== 'message' || !row.tools) continue;
    for (const tool of row.tools) {
      if (tool.toolUseId === toolUseId) return tool;
    }
  }
  return null;
}

/**
 * <a> 链接点击拦截：纯锚点（# 开头）放行 webview 默认滚动，其余一律
 * preventDefault 并把原始 href 上抛宿主（linkClick）——识别与路由在宿主侧
 * 单源完成（webview bundle 不依赖 core，且 iOS 导航守卫与 DOM 事件时序不可靠）。
 */
function onAnchorClick(target: Element, event: MouseEvent): void {
  const anchor = target.closest('a');
  if (!anchor) return;
  // 用 getAttribute 取原始 href：anchor.href 属性会 resolve 成绝对 URL
  const href = anchor.getAttribute('href');
  if (href == null || href === '') return;
  if (href.startsWith('#')) {
    // 纯锚点：不拦，交给 webview 默认页内滚动
    return;
  }
  event.preventDefault();
  post('linkClick', {href: href});
}
