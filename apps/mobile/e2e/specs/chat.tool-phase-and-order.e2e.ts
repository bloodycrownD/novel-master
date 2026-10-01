import {
  allowFixtureSkip,
  fixtureAssistantMessageId,
  fixtureSpecsDisabledReason,
  fixtureSpecsEnabled,
  isFixtureSessionAvailable,
  openFixtureSession,
} from '../helpers/fixture-session';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';

/**
 * E4 转录块序（thinking → body → tools）与工具阶段条。
 *
 * 结构性跑不动：thinking / tool_use / tool_result 三段块结构只能由 fixture SQL 造，
 * 纯 UI 发消息要在真实模型/工具环境里跑才有——不是本地 e2e 的可复现路径。
 * 所以整段默认跳过，除非 `E2E_RUN_FIXTURE_SPECS=1`（理由见 fixtureSpecsDisabledReason）。
 */
describe('E4 tool phase and block order', () => {
  before(function () {
    if (!fixtureSpecsEnabled()) {
      console.warn(fixtureSpecsDisabledReason());
      this.skip();
    }
  });

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