/**
 * Mermaid 全屏查看器共享 runtime（rich-document 预览 + chat-transcript 聊天两管线）。
 *
 * - 点击监听用 document 级事件委托：`closest('.mermaid-block__chart')`。
 *   两管线 DOM 会被 setDocument/renderRows 整树重建，逐图挂监听会丢；
 *   委托一次挂载永久有效。失败态（源码回退类名 mermaid-failed）不匹配
 *   chart 选择器，天然满足「失败不可进全屏」。
 * - 克隆不移动：进全屏时 cloneNode(true)，原图 DOM 零改动（批注文本流不受影响）。
 * - 已知边界（无需防护）：全屏打开时 streamCommit/renderRows 重建原图行，
 *   覆盖层持克隆 SVG 不受影响；覆盖层挂 body 级 portal（与 #rows/#doc 平级）不会被冲掉。
 * - 返回键走对称消息模式：开 → post('mermaidViewerOpened')；
 *   RN 拦截 BackHandler 后下发 closeMermaidViewer（各管线 bridge 分支）→
 *   closeMermaidViewer() → post('mermaidViewerClosed')。
 * - 覆盖层视图由各管线 main.ts 经 registerMermaidViewerView 注册（照
 *   registerRenderContextMenu 先例）；post 函数由管线注入（两桥 post 实现不同）。
 */

export type MermaidViewerViewProps = {
  /** 原图 SVG 的深克隆（cloneNode(true)），由覆盖层 effect 挂入视口容器。 */
  svgClone: Element;
};

/** null = 卸载（render(null, portal)）；非 null = 渲染全屏覆盖层。 */
export type RenderMermaidViewerView = (
  props: MermaidViewerViewProps | null,
) => void;

export type MermaidViewerPost = (
  type: string,
  payload?: Record<string, unknown>,
) => void;

let _renderView: RenderMermaidViewerView | null = null;
let _post: MermaidViewerPost | null = null;
let _open = false;

/** 由各管线 main 注册 Preact 覆盖层渲染/卸载实现。 */
export function registerMermaidViewerView(fn: RenderMermaidViewerView): void {
  _renderView = fn;
}

export function isMermaidViewerOpen(): boolean {
  return _open;
}

/** 从图表容器打开全屏：克隆 SVG（原图零改动）→ 渲染覆盖层 → 通知 RN。 */
export function openMermaidViewer(chart: Element): void {
  if (_open) {
    return;
  }
  const svg = chart.querySelector('svg');
  if (!svg) {
    return;
  }
  const svgClone = svg.cloneNode(true);
  _open = true;
  document.body.classList.add('mermaid-viewer-open');
  if (_renderView) {
    _renderView({ svgClone });
  }
  if (_post) {
    _post('mermaidViewerOpened', {});
  }
}

/** 关闭全屏：卸载覆盖层 → 解除禁滚 → 通知 RN（notifyHost=false 供测试/内部路径）。 */
export function closeMermaidViewer(notifyHost: boolean = true): void {
  if (!_open) {
    return;
  }
  _open = false;
  document.body.classList.remove('mermaid-viewer-open');
  if (_renderView) {
    _renderView(null);
  }
  if (notifyHost && _post) {
    _post('mermaidViewerClosed', {});
  }
}

/**
 * 挂接 document 级 click 委托 + 注入本管线 post。
 * 每管线 main.ts 模块初始化处调用一次（不进 setDocument/renderRows 链路）。
 */
export function attachMermaidViewerDelegation(post: MermaidViewerPost): void {
  _post = post;
  document.addEventListener('click', (event) => {
    if (_open) {
      return; // 覆盖层内点击由覆盖层自身处理（backdrop 关闭/双击缩放）
    }
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    const chart = target.closest('.mermaid-block__chart');
    if (chart) {
      openMermaidViewer(chart);
    }
  });
}
