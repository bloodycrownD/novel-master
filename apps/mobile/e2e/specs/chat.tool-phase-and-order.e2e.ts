import {
  E2E_FIXTURE_ASSISTANT_MESSAGE_ID,
  E2E_FIXTURE_SESSION_TITLE,
} from '../fixtures/session-ids';
import {appPage} from '../pageobjects/app.page';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';

describe('E4 tool phase and block order', () => {
  before(async () => {
    await appPage.ensureProject('E2E Tool Turn');
    await appPage.waitForLaunch();

    const sessionTitle = await $(
      `android=new UiSelector().textContains("${E2E_FIXTURE_SESSION_TITLE}")`,
    );
    if (!(await sessionTitle.isExisting())) {
      console.warn(
        `[e2e] Skipping E4: fixture session "${E2E_FIXTURE_SESSION_TITLE}" not found.`,
      );
      return;
    }
    await sessionTitle.click();
    await appPage.switchToChatPanel();
  });

  it('renders thinking → body → tools and phase bar without pending spinner', async function () {
    const sessionTitle = await $(
      `android=new UiSelector().textContains("${E2E_FIXTURE_SESSION_TITLE}")`,
    );
    if (!(await sessionTitle.isExisting())) {
      this.skip();
    }

    await chatTranscriptPage.openWebView();

    let messageId = E2E_FIXTURE_ASSISTANT_MESSAGE_ID;
    if (!messageId) {
      messageId = await browser.execute(() => {
        const row = document.querySelector('.row.message.assistant');
        return row?.getAttribute('data-id') ?? '';
      });
    }

    if (!messageId) {
      this.skip();
    }

    await chatTranscriptPage.assertAssistantBlockOrder(messageId);
    await chatTranscriptPage.expectNoPendingToolSpinner();

    const hasPhaseBar = await browser.execute((id: string) => {
      const row = document.querySelector(
        '.row.message.assistant[data-id="' + id + '"]',
      );
      return row?.querySelector('.tool-phase-bar') != null;
    }, messageId);

    const hasToolGroup = await browser.execute((id: string) => {
      const row = document.querySelector(
        '.row.message.assistant[data-id="' + id + '"]',
      );
      return row?.querySelector('.tool-group-section') != null;
    }, messageId);

    expect(hasPhaseBar || hasToolGroup).toBe(true);
    if (hasPhaseBar) {
      await chatTranscriptPage.expectToolPhaseBarVisible(true);
    }
  });
});
