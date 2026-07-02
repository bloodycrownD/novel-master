import {
  E2E_FIXTURE_ASSISTANT_MESSAGE_ID,
  E2E_FIXTURE_TAIL_ASSISTANT_MESSAGE_ID,
  E2E_FIXTURE_TAIL_USER_MESSAGE_ID,
} from '../fixtures/session-ids';
import {
  allowFixtureSkip,
  isFixtureSessionAvailable,
  openFixtureSession,
} from '../helpers/fixture-session';
import {
  assertBottomAfterRollback,
  sampleScrollAnchor,
} from '../helpers/scroll-anchor';
import {alertPage} from '../pageobjects/alert.page';
import {appPage} from '../pageobjects/app.page';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';
import {vfsPage} from '../pageobjects/vfs.page';

describe('E2 chat rollback', () => {
  let anchorMessageId: string;
  let messageCountBeforeRollback: number;

  before(async () => {
    await appPage.launchFresh('E2E Rollback');
    await chatTranscriptPage.sendComposerMessage('anchor-one');
    await chatTranscriptPage.sendComposerMessage('tail-two');
    await chatTranscriptPage.sendComposerMessage('tail-three');

    const ids = await chatTranscriptPage.getMessageIds();
    expect(ids.length).toBe(3);
    anchorMessageId = ids[0]!;
    messageCountBeforeRollback = ids.length;
    await chatTranscriptPage.scrollTranscriptUp(500);
  });

  it('上滚后回滚贴底（stick，不保留中间阅读位置）', async () => {
    const before = await sampleScrollAnchor(anchorMessageId);
    expect(before.anchorVisible).toBe(true);

    await chatTranscriptPage.longPressMessage(anchorMessageId);
    await chatTranscriptPage.tapMenuAction('rollback');
    await alertPage.acceptRollback();

    const toast = await vfsPage.readToastMessage();
    expect(toast).toContain('回滚成功');

    const idsAfter = await chatTranscriptPage.getMessageIds();
    expect(idsAfter.length).toBe(1);
    expect(idsAfter.length).toBe(messageCountBeforeRollback - 2);
    expect(idsAfter[0]).toBe(anchorMessageId);

    await assertBottomAfterRollback();
  });

  it('贴底时回滚后仍贴底', async () => {
    await chatTranscriptPage.sendComposerMessage('bottom-four');
    await chatTranscriptPage.sendComposerMessage('bottom-five');

    const idsBefore = await chatTranscriptPage.getMessageIds();
    expect(idsBefore.length).toBeGreaterThanOrEqual(2);
    const rollbackTargetId = idsBefore[idsBefore.length - 2]!;

    await assertBottomAfterRollback();

    await chatTranscriptPage.longPressMessage(rollbackTargetId);
    await chatTranscriptPage.tapMenuAction('rollback');
    await alertPage.acceptRollback();

    const toast = await vfsPage.readToastMessage();
    expect(toast).toContain('回滚成功');

    const idsAfter = await chatTranscriptPage.getMessageIds();
    expect(idsAfter.length).toBe(idsBefore.length - 1);

    await assertBottomAfterRollback();
  });

  it('keeps tool_result turn when rolling back on assistant with tool_use', async function () {
    if (!(await isFixtureSessionAvailable())) {
      if (allowFixtureSkip()) {
        this.skip();
        return;
      }
      throw new Error(
        '[e2e] Turn rollback fixture missing. Inject via e2e/scripts/README.md.',
      );
    }

    await openFixtureSession();
    await chatTranscriptPage.openWebView();

    const assistantId = E2E_FIXTURE_ASSISTANT_MESSAGE_ID;
    const tailUserId = E2E_FIXTURE_TAIL_USER_MESSAGE_ID;
    const tailAssistantId = E2E_FIXTURE_TAIL_ASSISTANT_MESSAGE_ID;

    await chatTranscriptPage.waitForMessage(assistantId);
    const idsBefore = await chatTranscriptPage.getMessageIds();
    expect(idsBefore.length).toBeGreaterThanOrEqual(4);
    expect(idsBefore).toContain(assistantId);
    expect(idsBefore).toContain(tailUserId);
    expect(idsBefore).toContain(tailAssistantId);

    await chatTranscriptPage.longPressMessage(assistantId);
    await chatTranscriptPage.tapMenuAction('rollback');
    await alertPage.acceptRollback();

    const toast = await vfsPage.readToastMessage();
    expect(toast).toContain('回滚成功');

    const idsAfter = await chatTranscriptPage.getMessageIds();
    expect(idsAfter.length).toBe(2);
    expect(idsAfter[0]).toBe(idsBefore[0]);
    expect(idsAfter[1]).toBe(assistantId);
    expect(idsAfter).not.toContain(tailUserId);
    expect(idsAfter).not.toContain(tailAssistantId);

    await chatTranscriptPage.assertMessageHasToolGroup(assistantId);
    await chatTranscriptPage.expectMessageMissing(tailAssistantId);
  });
});
