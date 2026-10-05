/**
 * Switch between NATIVE_APP and WEBVIEW contexts.
 *
 * 对话页**只有一个** WebView：`ChatConversationWebView` 加载 `chat-conversation`
 * 合成包（转录区 `#scroller` + composer dock 同一文档），独立的 composer WebView
 * 已随 `ChatComposer` 退役。所以「切到 composer」不再需要找第二个 WEBVIEW
 * context——切进对话页那一个，textarea 与发送钮都在里面。
 *
 * 但 {@link switchToWebView} 的「取第一个 WEBVIEW context」判据本身**依然不可靠**：
 * 同屏可能还挂着别的 WebView（文件编辑器的 `CodeEditorWebView`、Markdown 预览的
 * `RichDocumentWebView`、宏链动态区的 `ComposerInputWebView`），第一个 WEBVIEW
 * 未必是对话页。对话页一律走 {@link switchToConversationWebView}——它按 DOM 判据
 * （`#composer-dock` / `#scroller` / composer textarea）确认落在对话页文档上。
 *
 * ## 会话列表已回 RN（回滚 chat-webview-unify 双视图）
 * 会话列表不再住在 WebView 里：它回到 RN 的 `ChatSessionListPanel`
 * （`ManageHeader` + 会话行 `FlatList`，原生 a11y 树里 `UiSelector().text()`
 * 查得到），合成包 WebView 只承载**对话页**。所以本文件里的 WEBVIEW helper
 * **只服务对话页**，没有「列表视图」那一层语义——会话列表相关的操作（新建会话、
 * 点会话行进对话）一律切 NATIVE 定位，见 `pageobjects/app.page.ts`。
 *
 * （历史：双视图那阵子这里还有一对「切到列表视图 / 判断是不是列表视图」的 helper，
 * 以及 `#app[data-view]` / `#session-list` 两处 web 定位；随这次回滚一并删除。）
 */

/** 对话页合成包的文档判据：dock 容器 + 转录滚动态 + composer textarea。 */
const CONVERSATION_DOM_PROBES = [
  '#composer-dock',
  '#scroller',
  'textarea[data-testid="composer-input"]',
] as const;

export async function switchToNative(): Promise<void> {
  const contexts = await browser.getContexts();
  const native = contexts.find(c => String(c).includes('NATIVE'));
  if (native != null) {
    await browser.switchContext(String(native));
  }
}

/** First WEBVIEW context — **不要**用它找对话页，见 {@link switchToConversationWebView}。 */
export async function switchToWebView(): Promise<void> {
  await browser.waitUntil(
    async () => {
      const contexts = await browser.getContexts();
      return contexts.some(c => String(c).includes('WEBVIEW'));
    },
    {timeout: 20000, timeoutMsg: 'WebView context not available'},
  );
  const contexts = await browser.getContexts();
  const webview = contexts.find(c => String(c).includes('WEBVIEW'));
  if (webview == null) {
    throw new Error('WEBVIEW context missing');
  }
  await browser.switchContext(String(webview));
}

/** 当前 WEBVIEW context 里的文档是不是对话页合成包（按 DOM 判据，不靠 context 顺序）。 */
export async function isConversationDocument(): Promise<boolean> {
  try {
    const probe = await browser.execute(
      (selectors: string[]) =>
        selectors.some(selector => document.querySelector(selector) != null),
      CONVERSATION_DOM_PROBES as unknown as string[],
    );
    return probe === true;
  } catch {
    // 不是 web context / 该 context 尚未可执行 DOM 查询——一律当「不是对话页」。
    return false;
  }
}

/**
 * 切到**对话页** WebView 的 context（带 DOM 判据）。
 *
 * 逐个 WEBVIEW context 试，命中 `#composer-dock`/`#scroller`/composer textarea 任一即认定。
 * WebView 刚挂载/正在加载时 DOM 还没装配好，所以外层是重试循环而不是一次判定。
 */
export async function switchToConversationWebView(timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen: string[] = [];
  while (Date.now() < deadline) {
    const contexts = (await browser.getContexts())
      .map(String)
      .filter(context => context.includes('WEBVIEW'));
    seen = contexts;
    for (const context of contexts) {
      try {
        await browser.switchContext(context);
      } catch {
        // 该 context 刚被宿主销毁/重建，换下一个试。
        continue;
      }
      if (await isConversationDocument()) {
        return;
      }
    }
    await browser.pause(500);
  }
  throw new Error(
    '[e2e] 对话页 WebView 未就绪：所有 WEBVIEW context 都没命中判据 ' +
      `${CONVERSATION_DOM_PROBES.join(' / ')}（当前 context 列表：${JSON.stringify(seen)}）。` +
      ' 先确认已进入某个会话（合成包只在对话页挂载）。',
  );
}

export async function logActiveContext(label: string): Promise<void> {
  const contexts = await browser.getContexts();
  const active = await browser.getContext();
  console.log(`[e2e/context] ${label}`, {contexts, active});
}