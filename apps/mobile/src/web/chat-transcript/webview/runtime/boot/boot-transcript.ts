/**
 * chat-transcript 启动序列：宿主桥监听 → 壳事件 → ready。
 * 与 main 的 Preact 注册分离，避免入口文件混杂委托细节。
 */
import {state} from '../state/state';
import {post, handleHostMessage} from '../bridge';
import {bindHostMessageChannel} from '@web/shared/host-message-channel';
import {TRANSCRIPT_CAPABILITIES} from '../../../transcript-capabilities';
import {bindShellEvents} from './bind-shell-events';

/** 绑定 RN WebView / iframe 的 message 通道（document + window 双注册统一在 shared）。 */
export function bindHostMessageEvents(): void {
  bindHostMessageChannel(handleHostMessage);
}

/**
 * DOM 就绪后：壳委托 + 向宿主声明 ready（含能力清单，B-2）。
 * 符号名保留供契约测检索。
 */
export function bootTranscript(): void {
  bindShellEvents();
  // RN WebView html source 上 DOMContentLoaded 可能已错过；readyState 兜底。
  // capabilities 是能力协商真源（RN 据此启用块级渲染）；version 仅作辅助。
  post('ready', {
    version: 'm4',
    capabilities: TRANSCRIPT_CAPABILITIES,
    readyState: document.readyState,
  });
  state.ready = true;
}

/** 按 document.readyState 调度 bootTranscript。 */
export function startTranscriptBoot(): void {
  bindHostMessageEvents();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTranscript);
  } else {
    bootTranscript();
  }
}
