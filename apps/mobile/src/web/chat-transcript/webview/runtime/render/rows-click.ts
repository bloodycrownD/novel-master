import {state} from '../state/state';
import {post} from '../bridge';
import {closeContextMenu} from '../menu/menu';
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
  if (action === 'load-older') {
    requestLoadOlder();
  }
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
