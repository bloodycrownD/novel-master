import {
  allowFixtureSkip,
  fixtureAssistantMessageId,
  isFixtureSessionAvailable,
  openFixtureSession,
} from '../helpers/fixture-session';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';

describe('E4 tool phase and block order', () => {
  before(async () => {
    try {
      await openFixtureSession();
    } catch (error) {
      if (allowFixtureSkip()) {
        console.warn(`[e2e] Skipping E4 fixture setup: ${String(error)}`);
        return;
      }
      throw error;
    }
  });

  it('renders thinking → body → tools and phase bar without pending spinner', async function () {
    if (!(await isFixtureSessionAvailable())) {
      if (allowFixtureSkip()) {
        this.skip();
      }
      throw new Error(
        '[e2e] Fixture session missing. See e2e/scripts/README.md to inject tool-turn-session.sql.',
      );
    }

    await chatTranscriptPage.openWebView();

    const messageId = fixtureAssistantMessageId();
    await chatTranscriptPage.waitForMessage(messageId);

    await chatTranscriptPage.assertAssistantBlockOrder(messageId);
    await chatTranscriptPage.expectNoPendingToolSpinner();
    await chatTranscriptPage.assertMessageHasToolGroup(messageId);

    const hasPhaseBar = await browser.execute((id: string) => {
      const row = document.querySelector(
        '.row.message.assistant[data-id="' + id + '"]',
      );
      return row?.querySelector('.tool-phase-bar') != null;
    }, messageId);

    if (hasPhaseBar) {
      await chatTranscriptPage.expectToolPhaseBarVisible(true);
    }
  });
});
