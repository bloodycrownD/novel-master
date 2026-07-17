import { state, BRIDGE_V, type TranscriptFlags } from '../state/state';
import {
  applySnapshot,
  applyPrependPage,
  applyAppendTailRows,
  applyStreamCommit,
} from '../render/snapshot';
import {
  appendStreamDelta,
  applyStreamBatch,
  setStreamToolInvokingDom,
} from '../stream/stream';
import { clearStreamRichUpgrade } from '../stream/stream-markdown';
import { closeContextMenu } from '../menu/menu';
import { flagsEqual, renderRows } from '../render/row-render';

/** 宿主下发的主题 token（最小字段）。 */
export type HostTheme = {
  background?: string;
  text?: string;
  textSecondary?: string;
  primary?: string;
  danger?: string;
  surface?: string;
  borderLight?: string;
};

/**
 * RN 桥：postMessage、主题应用与宿主消息分发。
 */
export function post(type: string, payload?: Record<string, unknown>): void {
  const msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(msg);
  }
}

export function applyTheme(theme: HostTheme | null | undefined): void {
  if (!theme) return;
  const root = document.documentElement;
  root.style.setProperty('--bg', theme.background || '#fff');
  root.style.setProperty('--text', theme.text || '#111');
  root.style.setProperty('--text-secondary', theme.textSecondary || '#666');
  root.style.setProperty('--primary', theme.primary || '#007aff');
  root.style.setProperty('--danger', theme.danger || '#d92d20');
  root.style.setProperty('--surface', theme.surface || '#f2f2f7');
  root.style.setProperty('--border', theme.borderLight || '#e5e5ea');
}

export function handleHostMessage(raw: unknown): void {
  let msg: { v?: number; type?: string; payload?: Record<string, unknown> };
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof msg);
  } catch {
    return;
  }
  if (!msg || msg.v !== BRIDGE_V || !msg.type) return;
  const p = (msg.payload || {}) as Record<string, any>;
  switch (msg.type) {
    case 'init':
      applyTheme(p.theme);
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
      applyTheme(p.theme);
      break;
    case 'closeMenu':
      closeContextMenu(true);
      break;
    default:
      break;
  }
}

export function onHostMessage(event: MessageEvent | { data?: unknown }): void {
  const data = event && event.data;
  if (data == null) return;
  handleHostMessage(data);
}
