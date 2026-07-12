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

const FIXTURE_ANCHOR_USER_ID = 'e2e-fix-u1';
const FIXTURE_ANCHOR_USER_TEXT = 'read file';

describe('E2 chat rollback', () => {
  describe('T-E1 plain user undo_send', () => {
    let anchorMessageId: string;

    before(async () => {
      await appPage.launchFresh('E2E Rollback Undo');
      await chatTranscriptPage.sendComposerMessage('anchor-one');
      await chatTranscriptPage.sendComposerMessage('tail-two');
      await chatTranscriptPage.sendComposerMessage('tail-three');

      const ids = await chatTranscriptPage.getMessageIds();
      expect(ids.length).toBe(3);
      anchorMessageId = ids[0]!;
      await chatTranscriptPage.scrollTranscriptUp(500);
    });

    it('删除 plain user 锚点并恢复 Composer 原文', async () => {
      const before = await sampleScrollAnchor(anchorMessageId);
      expect(before.anchorVisible).toBe(true);

      await chatTranscriptPage.longPressMessage(anchorMessageId);
      await chatTranscriptPage.tapMenuAction('rollback');
      await alertPage.acceptRollback();

      const toast = await vfsPage.readToastMessage();
      expect(toast).toContain('回滚成功');

      const idsAfter = await chatTranscriptPage.getMessageIds();
      expect(idsAfter.length).toBe(0);
      expect(idsAfter).not.toContain(anchorMessageId);

      await chatTranscriptPage.expectComposerText('anchor-one');
      await assertBottomAfterRollback();
    });

    it('贴底时回滚后仍贴底', async () => {
      await chatTranscriptPage.sendComposerMessage('bottom-four');
      await chatTranscriptPage.sendComposerMessage('bottom-five');

      const idsBefore = await chatTranscriptPage.getMessageIds();
      expect(idsBefore.length).toBe(2);
      const rollbackTargetId = idsBefore[idsBefore.length - 2]!;

      await assertBottomAfterRollback();

      await chatTranscriptPage.longPressMessage(rollbackTargetId);
      await chatTranscriptPage.tapMenuAction('rollback');
      await alertPage.acceptRollback();

      const toast = await vfsPage.readToastMessage();
      expect(toast).toContain('回滚成功');

      const idsAfter = await chatTranscriptPage.getMessageIds();
      expect(idsAfter.length).toBe(0);

      await assertBottomAfterRollback();
    });
  });

  describe('T-E2 assistant rewind', () => {
    it('keeps assistant anchor when rolling back on assistant with tool_use', async function () {
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

  describe('T-E3 composer draft overwrite', () => {
    it('回滚 plain user 时 Composer 覆盖旧草稿', async function () {
      if (!(await isFixtureSessionAvailable())) {
        if (allowFixtureSkip()) {
          this.skip();
          return;
        }
        throw new Error(
          '[e2e] Fixture session missing for composer draft test. Inject via e2e/scripts/README.md.',
        );
      }

      await openFixtureSession();
      await chatTranscriptPage.openWebView();
      await chatTranscriptPage.waitForMessage(FIXTURE_ANCHOR_USER_ID);

      await chatTranscriptPage.setComposerText('old draft before rollback');

      await chatTranscriptPage.longPressMessage(FIXTURE_ANCHOR_USER_ID);
      await chatTranscriptPage.tapMenuAction('rollback');
      await alertPage.acceptRollback();

      const toast = await vfsPage.readToastMessage();
      expect(toast).toContain('回滚成功');

      await chatTranscriptPage.expectComposerText(FIXTURE_ANCHOR_USER_TEXT);
    });
  });
});
