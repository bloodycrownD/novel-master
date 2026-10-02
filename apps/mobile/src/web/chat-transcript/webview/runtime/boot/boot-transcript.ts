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
 * boot 可选动作开关（Step 1 / chat-webview-unify 工厂化）。
 * 缺省 = 拆分前 main.ts 行为（旧包行为零变化）。
 */
export type TranscriptBootOptions = {
  /** 是否自绑宿主 message 通道；false 时由合成入口单次注册统一通道。 */
  bindChannel?: boolean;
  /** 是否由本 runtime 上抛 ready；false 时由合成入口发单条 v2 ready。 */
  emitReady?: boolean;
};

/**
 * DOM 就绪后：壳委托 + 向宿主声明 ready（含能力清单，B-2）。
 * 符号名保留供契约测检索。
 *
 * emitReady 经入参/闭包透传（禁模块级可变 flag：同一文档内两 runtime
 * 可能以不同参数 boot，模块级 flag 会互相污染）。
 */
export function bootTranscript(options: TranscriptBootOptions = {}): void {
  bindShellEvents();
  // RN WebView html source 上 DOMContentLoaded 可能已错过；readyState 兜底。
  // capabilities 是能力协商真源（RN 据此启用块级渲染）；version 仅作辅助。
  if (options.emitReady !== false) {
    post('ready', {
      version: 'm4',
      capabilities: TRANSCRIPT_CAPABILITIES,
      readyState: document.readyState,
    });
  }
  state.ready = true;
}

/** 按 document.readyState 调度 bootTranscript。 */
export function startTranscriptBoot(options: TranscriptBootOptions = {}): void {
  if (options.bindChannel !== false) {
    bindHostMessageEvents();
  }
  if (document.readyState === 'loading') {
    // 闭包捕获本次 options：不同实例的 bindChannel/emitReady 互不影响
    document.addEventListener('DOMContentLoaded', () =>
      bootTranscript(options),
    );
  } else {
    bootTranscript(options);
  }
}
