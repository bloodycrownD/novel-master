import {alertPage} from '../pageobjects/alert.page';
import {appPage} from '../pageobjects/app.page';
import {chatTranscriptPage} from '../pageobjects/chat-transcript.page';
import {vfsPage} from '../pageobjects/vfs.page';

/**
 * E3 回滚恢复 VFS。
 *
 * 隔离：before 用 UI 自建**本轮唯一**项目（会话 + 两个 VFS 文件），after UI 删掉该项目
 * （回滚本身已经把文件删光了，但项目与会话仍在，不清就会在 noReset 下逐轮堆积）。
 */
describe('E3 chat rollback restores VFS', () => {
  let projectName = '';
  let anchorMessageId: string;

  before(async () => {
    projectName = await appPage.launchFresh('E2E Rollback VFS');
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

  after(async () => {
    if (projectName === '') {
      return;
    }
    await appPage.deleteProjectViaDrawer(projectName);
  });

  it('plain user undo_send 回滚至发送前 prior（首条锚点清空工作区）', async () => {
    await chatTranscriptPage.openMessageMenu(anchorMessageId);
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