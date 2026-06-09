/**
 * Switch between NATIVE_APP and WEBVIEW transcript contexts.
 */
export async function switchToNative(): Promise<void> {
  const contexts = await browser.getContexts();
  const native = contexts.find(c => String(c).includes('NATIVE'));
  if (native != null) {
    await browser.switchContext(String(native));
  }
}

/** First WEBVIEW context (chat transcript). */
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

export async function logActiveContext(label: string): Promise<void> {
  const contexts = await browser.getContexts();
  const active = await browser.getContext();
  console.log(`[e2e/context] ${label}`, {contexts, active});
}
