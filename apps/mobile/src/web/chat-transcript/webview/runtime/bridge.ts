import {state, BRIDGE_V, type TranscriptFlags} from './state/state';
import {
  applySnapshot,
  applyPrependPage,
  applyAppendTailRows,
  applyStreamCommit,
} from './render/snapshot';
import {
  appendStreamDelta,
  applyStreamBatch,
  setStreamToolInvokingDom,
} from './stream/stream';
import {clearStreamRichUpgrade} from './stream/stream-markdown';
import {closeContextMenu} from './menu/menu';
import {closeMermaidViewer} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';
import {createBoundPost} from '@web/shared/post';
import {matchHostMessage} from '@web/shared/host-message-channel';
import {applyHostTheme} from '@web/shared/host-theme';
import {flagsEqual, renderRows} from './render/row-logic';
import {scheduleStickIfNearBottom} from './scroll/scroll';

// HostTheme 超集与条件式写入统一在 @web/shared/host-theme（web/C-orch-2）
export type {HostTheme} from '@web/shared/host-theme';
export {applyHostTheme};

/**
 * RN 桥：postMessage 经 shared 工厂绑定 BRIDGE_V（消息头 v:1 不变）。
 */
export const post = createBoundPost(BRIDGE_V);

// 可见性上报：RN 侧据此在「隐藏期间有改画推送」时强制重挂 WebView，
// 规避 Android WebView 恢复显示后仍渲染摘除前的旧帧（生成中残留的根因）。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    post('visibility', {hidden: document.hidden});
  });
}

export function handleHostMessage(raw: unknown): void {
  const msg = matchHostMessage(raw, BRIDGE_V);
  if (!msg) return;
  const p = (msg.payload || {}) as Record<string, any>;
  switch (msg.type) {
    case 'init':
      applyHostTheme(p.theme);
      if (p.flags) {
        state.flags = {
          richText: !!p.flags.richText,
          menuDisabled: !!p.flags.menuDisabled,
        };
      }
      break;
    case 'sessionSnapshot':
      applySnapshot(p);
      break;
    case 'prependPage':
      applyPrependPage(p);
      break;
    case 'appendTailRows':
      applyAppendTailRows(p);
      break;
    case 'streamDelta': {
      appendStreamDelta(p.kind, p.delta || '', p.html || '');
      break;
    }
    case 'streamBatch': {
      applyStreamBatch(p);
      break;
    }
    case 'streamReset':
      clearStreamRichUpgrade();
      state.stream = {
        text: '',
        thinking: '',
        textHtml: '',
        thinkingHtml: '',
        toolInvoking: false,
      };
      renderRows();
      break;
    case 'streamCommit':
      clearStreamRichUpgrade();
      state.stream = {
        text: '',
        thinking: '',
        textHtml: '',
        thinkingHtml: '',
        toolInvoking: false,
      };
      applyStreamCommit(p);
      break;
    case 'streamToolInvoking':
      setStreamToolInvokingDom(!!p.active);
      break;
    case 'flagsUpdate':
      if (p.flags) {
        const nextFlags: TranscriptFlags = {
          richText: !!p.flags.richText,
          menuDisabled: !!p.flags.menuDisabled,
        };
        if (flagsEqual(state.flags, nextFlags)) {
          break;
        }
        const richToggledOn = !state.flags.richText && nextFlags.richText;
        state.flags = nextFlags;
        if (state.flags.menuDisabled) {
          closeContextMenu(true);
        }
        // Rich on: wait for sessionSnapshot rows with textHtml (avoid escapeHtml fallback).
        if (!richToggledOn) {
          renderRows();
        }
      }
      break;
    case 'themeUpdate':
      applyHostTheme(p.theme);
      break;
    case 'closeMenu':
      closeContextMenu(true);
      break;
    // Android 返回键：RN 拦截后下发关闭；关闭后回发 mermaidViewerClosed 复位 RN 态
    case 'closeMermaidViewer':
      closeMermaidViewer(true);
      break;
    case 'stickIfNearBottom':
      scheduleStickIfNearBottom();
      break;
    default:
      break;
  }
}
