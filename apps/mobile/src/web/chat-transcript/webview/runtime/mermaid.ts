/**
 * chat-transcript WebView mermaid 渲染 runtime（懒加载 + 按源码去重 + 防抖）。
 *
 * 挂接点：sessionSnapshot / prependPage / appendTailRows 历史行渲染后与
 * streamCommit 定稿后，由 render/snapshot.ts 调 scheduleMermaidScan 触发。
 * 流式期（streamDelta/streamBatch）不触发：流式 rich 路径每 rAF 整段替换
 * bubble-body innerHTML，图表会被冲掉；流式尾保留源码占位（共享 CSS 弱化展示）。
 * 流式增量岛约束：只操作 mermaid 节点自身与新建容器，不重排周边 DOM，
 * 且跳过 #stream-tail 子树。
 */
import {
  createMermaidSourceCache,
  renderMermaidCodeBlocks,
} from '@web/shared/mermaid-core';

const mermaidCache = createMermaidSourceCache();

const SCAN_DEBOUNCE_MS = 150;
let scanTimer: number | null = null;

/** 防抖触发一次历史行 mermaid 扫描（多次连发只跑一轮）。 */
export function scheduleMermaidScan(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (scanTimer != null) {
    window.clearTimeout(scanTimer);
  }
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void runMermaidScan();
  }, SCAN_DEBOUNCE_MS);
}

/** 立即扫描 #rows（历史行）；#stream-tail 子树在流式期由宿主整段替换，跳过。 */
export async function runMermaidScan(): Promise<void> {
  const rows = document.getElementById('rows');
  if (!rows) {
    return;
  }
  await renderMermaidCodeBlocks(rows, mermaidCache, {
    skip: code => !!code.closest('#stream-tail'),
  });
}

/** 测试隔离：取消挂起的防抖扫描。 */
export function cancelPendingMermaidScanForTests(): void {
  if (scanTimer != null && typeof window !== 'undefined') {
    window.clearTimeout(scanTimer);
    scanTimer = null;
  }
}
