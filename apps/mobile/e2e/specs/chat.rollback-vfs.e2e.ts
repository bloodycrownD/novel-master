import {alertPage} from '../pageobjects/alert.page';
import {appPage} from '../pageobjects/app.page';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';
import {vfsPage} from '../pageobjects/vfs.page';

describe('E3 chat rollback restores VFS', () => {
  let anchorMessageId: string;

  before(async () => {
    await appPage.launchFresh('E2E Rollback VFS');
    await appPage.switchToWorkspacePanel();
    await vfsPage.createFile('file-a.md');
    await appPage.switchToChatPanel();
    await chatTranscriptPage.sendComposerMessage('vfs-anchor');

    const ids = await chatTranscriptPage.getMessageIds();
    expect(ids.length).toBeGreaterThanOrEqual(1);
    anchorMessageId = ids[ids.length - 1]!;

    await appPage.switchToWorkspacePanel();
    await vfsPage.createFile('file-b.md');
    await appPage.switchToChatPanel();
    await chatTranscriptPage.sendComposerMessage('after-vfs-edit');
  });

  it('plain user undo_send 回滚至发送前 prior（首条锚点清空工作区）', async () => {
    await chatTranscriptPage.longPressMessage(anchorMessageId);
    await chatTranscriptPage.tapMenuAction('rollback');
    await alertPage.acceptRollback();

    const toast = await vfsPage.readToastMessage();
    expect(toast).toContain('回滚成功');

    const idsAfter = await chatTranscriptPage.getMessageIds();
    expect(idsAfter.length).toBe(0);

    await appPage.switchToWorkspacePanel();
    await vfsPage.expectRowMissing('file-a.md');
    await vfsPage.expectRowMissing('file-b.md');
  });
});
