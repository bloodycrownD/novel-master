/**
 * WebView 代码块复制按钮点击委托（chat-transcript / rich-document 共享）。
 *
 * - 按钮是 HTML 管道产出的 pre 内空 span.code-copy（sanitize 白名单本就放行
 *   span+class），label 走 CSS 伪元素，零 DOM 文本（批注文本流零偏移）；
 * - document 捕获阶段委托 + stopPropagation：一次性挂接、不随 innerHTML 整段
 *   替换丢失；代码块若嵌在 [data-action] 容器内，先于 rows-click 等冒泡委托
 *   拦截，避免「复制 + 折叠」双触发；
 * - 复制本体走 RN 侧原生 Clipboard（宿主消息 copyCode），WebView 不碰
 *   execCommand/clipboard API（iOS WKWebView 不可用）。
 */
type PostToHost = (type: string, payload: Record<string, unknown>) => void;

/** 复制成功反馈时长（按钮伪元素切「已复制」）。 */
const COPY_FEEDBACK_MS = 1500;

/** 挂接点击委托（幂等：重复调用只挂一次）。 */
let attached = false;
export function attachCodeCopyDelegation(post: PostToHost): void {
  if (attached || typeof document === 'undefined') {
    return;
  }
  attached = true;
  document.addEventListener(
    'click',
    event => {
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== 'function') {
        return;
      }
      const btn = target.closest('.code-copy');
      if (!btn) {
        return;
      }
      event.stopPropagation();
      const code = btn.closest('pre')?.querySelector('code');
      const text = code?.textContent ?? '';
      if (!text) {
        return;
      }
      post('copyCode', {code: text});
      btn.classList.add('copied');
      window.setTimeout(() => btn.classList.remove('copied'), COPY_FEEDBACK_MS);
    },
    true,
  );
}
