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

/** 与 WebView transcript NEAR_BOTTOM_THRESHOLD_PX 对齐。 */
const NEAR_BOTTOM_THRESHOLD_PX = 80;

/**
 * 断言回滚后 transcript 贴底（stick intent 生效）。
 */
export async function assertBottomAfterRollback(
  maxOffsetFromBottom = NEAR_BOTTOM_THRESHOLD_PX,
): Promise<void> {
  await switchToWebView();
  const offset = await browser.execute(() => {
    const scroller = document.getElementById('scroller');
    if (scroller == null) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(
      0,
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
    );
  });
  expect(offset).toBeLessThanOrEqual(maxOffsetFromBottom);
}
