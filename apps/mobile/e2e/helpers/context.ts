/**
 * Switch between NATIVE_APP and WEBVIEW contexts.
 *
 * chat-webview-unify 之后，对话页**只有一个** WebView：`ChatConversationWebView` 加载
 * `chat-conversation` 合成包（转录区 `#scroller` + composer dock + 会话列表同一文档），
 * 独立的 composer WebView 已随 `ChatComposer` 退役。所以「切到 composer」不再需要
 * 找第二个 WEBVIEW context——切进对话页那一个，textarea 与发送钮都在里面。
 *
 * 但 {@link switchToWebView} 的「取第一个 WEBVIEW context」判据本身**依然不可靠**：
 * 同屏可能还挂着别的 WebView（文件编辑器的 `CodeEditorWebView`、Markdown 预览的
 * `RichDocumentWebView`、宏链动态区的 `ComposerInputWebView`），第一个 WEBVIEW
 * 未必是对话页。对话页一律走 {@link switchToConversationWebView}——它按 DOM 判据
 * （`#composer-dock` / `#scroller` / composer textarea）确认落在对话页文档上。
 *
 * ## 双视图（第二阶段 wave-3 后）
 * 会话列表也搬进了同一个文档，`#app` 上的 `data-view` 在 `list` / `conversation`
 * 之间切，节点不销毁。**DOM 判据对两个视图都成立**（列表态下 `#composer-dock`
 * 只是 `display:none`，仍在 DOM 里），所以 {@link switchToConversationWebView}
 * 在列表态同样能命中——它负责「切到那个唯一 WebView」，
 * 「切到列表视图」这层语义另由 {@link switchToSessionListView} 承担（等 `data-view`）。
 */

/** 对话页合成包的文档判据：dock 容器 + 转录滚动态 + composer textarea。 */
const CONVERSATION_DOM_PROBES = [
  '#composer-dock',
  '#scroller',
  'textarea[data-testid="composer-input"]',
  // 列表视图的壳。wave-1 起 #app 下恒挂 `#session-list`（`display:none` 切换），
  // 拿它当判据能让「列表视图下还没渲染 composer textarea」的冷启动窗口也能命中。
  '#session-list',
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

/**
 * 当前文档是不是停在**列表视图**（`#app[data-view="list"]`）。
 *
 * 判据用 `data-view` 属性而不是「`#session-list` 是否可见」：列表视图靠
 * `display:none` 切显隐，`isDisplayed()` 在 WebView 里对 `display:none` 的判读
 * 各家 WebDriver 实现不一致（ChromeDriver 认，Appium 的 chromedriver 转发层
 * 未必），而属性值是 web 侧真源（`viewState` 下行直接写上去的），零歧义。
 */
export async function isSessionListView(): Promise<boolean> {
  try {
    const view = await browser.execute(() => {
      const app = document.getElementById('app');
      return app == null ? null : app.getAttribute('data-view');
    });
    return view === 'list';
  } catch {
    return false;
  }
}

/**
 * 切到会话列表视图（web context，且 `#app[data-view="list"]` 已就位）。
 *
 * 为什么不能只调 {@link switchToConversationWebView} 了事：那个 helper 只保证
 * 「context 落在对话页文档上」，不保证「视图已切到列表」。冷启动首帧固定是
 * conversation 视图（壳的初值，见 `index.html` 注释），`viewState=list` 要等宿主
 * ready 握手后才补发——此时 DOM 判据已经全部命中，但用户看到的是对话页。
 * 直接点 `#session-list-create` 会点到 `display:none` 的元素上（Appium 报
 * 「element not interactable」甚至静默点空），所以这一层等待是必须的。
 */
export async function switchToSessionListView(timeoutMs = 20000): Promise<void> {
  // 总预算 = timeoutMs：前半给 WebView context 切换、余下给 data-view 轮询——
  // 原先两段各吃满 timeoutMs（实际 2×），失败排障要等双倍时间（cr2-G-2）。
  const startedAt = Date.now();
  await switchToConversationWebView(Math.ceil(timeoutMs / 2));
  const contextMs = Date.now() - startedAt;
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    if (await isSessionListView()) {
      return;
    }
    await browser.pause(400);
  }
  throw new Error(
    '[e2e] 未切到会话列表视图（context 切换已耗时 ' +
      `${contextMs}ms / data-view 轮询 ${Date.now() - startedAt - contextMs}ms）：#app[data-view] 一直是 ` +
      `${JSON.stringify(
        await browser
          .execute(() => document.getElementById('app')?.getAttribute('data-view') ?? null)
          .catch(() => null),
      )}。` +
      '先确认应用停在 chat tab 且选中项目（列表快照需要 projectId）。',
  );
}