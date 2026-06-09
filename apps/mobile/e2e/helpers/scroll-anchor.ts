import {switchToWebView} from './context';

/** Sample scrollTop and element Y for rollback jump detection. */
export type ScrollAnchorSample = {
  scrollTop: number;
  anchorTop: number;
  anchorVisible: boolean;
};

/**
 * Record WebView scroll position and anchor message visibility before rollback.
 */
export async function sampleScrollAnchor(
  messageId: string,
): Promise<ScrollAnchorSample> {
  await switchToWebView();
  const row = await $(`.row.message[data-id="${messageId}"]`);
  await row.waitForExist({timeout: 15000});

  return browser.execute(
    (id: string) => {
      const scroller = document.getElementById('scroller');
      const el = document.querySelector(
        '.row.message[data-id="' + id + '"]',
      ) as HTMLElement | null;
      if (scroller == null || el == null) {
        return {scrollTop: 0, anchorTop: 0, anchorVisible: false};
      }
      const rect = el.getBoundingClientRect();
      const viewTop = scroller.getBoundingClientRect().top;
      const viewBottom = viewTop + scroller.clientHeight;
      const visible = rect.bottom > viewTop && rect.top < viewBottom;
      return {
        scrollTop: scroller.scrollTop,
        anchorTop: rect.top - viewTop,
        anchorVisible: visible,
      };
    },
    messageId,
  );
}

/**
 * Assert anchor stayed in viewport and scroll did not jump to page top after tail shrink.
 */
export async function assertAnchorStableAfterRollback(
  before: ScrollAnchorSample,
  messageId: string,
  maxScrollDelta = 80,
): Promise<void> {
  const after = await sampleScrollAnchor(messageId);
  expect(after.anchorVisible).toBe(true);
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThan(
    maxScrollDelta + Math.max(0, before.anchorTop - after.anchorTop),
  );
}
