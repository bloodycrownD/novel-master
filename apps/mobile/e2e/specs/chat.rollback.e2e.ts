import {
  assertAnchorStableAfterRollback,
  sampleScrollAnchor,
} from '../helpers/scroll-anchor';
import {alertPage} from '../pageobjects/alert.page';
import {appPage} from '../pageobjects/app.page';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';
import {vfsPage} from '../pageobjects/vfs.page';

describe('E2 chat rollback', () => {
  let anchorMessageId: string;

  before(async () => {
    await appPage.launchFresh('E2E Rollback');
    await chatTranscriptPage.sendComposerMessage('anchor-one');
    await chatTranscriptPage.sendComposerMessage('tail-two');
    await chatTranscriptPage.sendComposerMessage('tail-three');

    const ids = await chatTranscriptPage.getMessageIds();
    expect(ids.length).toBeGreaterThanOrEqual(3);
    anchorMessageId = ids[0]!;
    await chatTranscriptPage.scrollTranscriptUp(500);
  });

  it('rolls back tail messages without jumping to page top', async () => {
    const before = await sampleScrollAnchor(anchorMessageId);
    expect(before.anchorVisible).toBe(true);

    await chatTranscriptPage.longPressMessage(anchorMessageId);
    await chatTranscriptPage.tapMenuAction('rollback');
    await alertPage.acceptRollback();

    const toast = await vfsPage.readToastMessage();
    expect(toast).toContain('回滚成功');

    const idsAfter = await chatTranscriptPage.getMessageIds();
    expect(idsAfter.length).toBeLessThan(3);
    expect(idsAfter).toContain(anchorMessageId);

    await assertAnchorStableAfterRollback(before, anchorMessageId);
  });
});
